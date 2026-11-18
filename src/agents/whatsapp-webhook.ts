import { and, eq, gt, ne, sql } from "drizzle-orm";
import { restaurantConfig } from "../../config/restaurant";
import { withSystemContext } from "@/db/context";
import { webhookEvents } from "@/db/schema";
import { providers } from "@/providers";
import { isWebhookSignatureError } from "@/providers/payment/types";
import type { NotificationProvider } from "@/providers/notification/types";
import { runAgent, type FrameworkDeps } from "./framework";
import { ensureAgentsRegistered } from "./index";
import { SUPPORT_KEY } from "./support";

export type WhatsAppWebhookResult = {
  status: 200 | 400 | 401;
  outcome: "processed" | "duplicate" | "throttled" | "agents_off" | "bad_signature" | "bad_payload";
};

/** Answers a single number can ask for before it is held back: each one can cost a model call. */
const MAX_PER_HOUR = 10;

/**
 * An inbound WhatsApp message. Same rules as the other webhooks: the signature is checked on the raw body, the
 * message is stored under a unique key so a replay changes nothing, and a failure while processing removes the
 * event again so the provider's retry is processed. A message starts the support agent, which only proposes: nothing
 * is sent to the customer from here. What was stored is who and which message, not what they wrote.
 */
export async function handleWhatsAppWebhook(rawBody: string, headers: Headers, deps: FrameworkDeps & { provider?: NotificationProvider } = {}): Promise<WhatsAppWebhookResult> {
  const config = deps.config ?? restaurantConfig;
  if (!config.features.ai_agents) return { status: 200, outcome: "agents_off" };
  ensureAgentsRegistered();
  const now = deps.now ?? new Date();
  const provider = deps.provider ?? providers().notification;

  let message;
  try {
    message = provider.parseInbound(rawBody, headers);
  } catch (err) {
    return isWebhookSignatureError(err) ? { status: 401, outcome: "bad_signature" } : { status: 400, outcome: "bad_payload" };
  }

  const url = { url: deps.systemUrl };
  const decision = await withSystemContext(async (tx) => {
    const [stored] = await tx
      .insert(webhookEvents)
      .values({ provider: "whatsapp", eventId: message.id, eventType: "message", payload: { id: message.id, from: message.from }, receivedAt: now })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (!stored) return { outcome: "duplicate" as const };
    const [recent] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.provider, "whatsapp"), sql`${webhookEvents.payload}->>'from' = ${message.from}`, gt(webhookEvents.receivedAt, new Date(now.getTime() - 3_600_000)), ne(webhookEvents.id, stored.id)));
    if (recent.n >= MAX_PER_HOUR) {
      await tx.update(webhookEvents).set({ processedAt: now }).where(eq(webhookEvents.id, stored.id));
      return { outcome: "throttled" as const };
    }
    return { outcome: "run" as const, id: stored.id };
  }, url);
  if (decision.outcome !== "run") return { status: 200, outcome: decision.outcome };

  try {
    await runAgent(SUPPORT_KEY, { trigger: "inbound", input: message }, deps);
  } catch (err) {
    await withSystemContext((tx) => tx.delete(webhookEvents).where(eq(webhookEvents.id, decision.id)), url);
    throw err;
  }
  await withSystemContext((tx) => tx.update(webhookEvents).set({ processedAt: now }).where(eq(webhookEvents.id, decision.id)), url);
  return { status: 200, outcome: "processed" };
}
