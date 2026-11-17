import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { withRequestContext, withSystemContext, type RequestContext } from "@/db/context";
import { orders, payments } from "@/db/schema";
import { OrderNotFoundError } from "@/domain/orders/transitions";
import type { PaymentProvider } from "@/providers/payment/types";

export type StartPaymentError = "not_payable" | "expired" | "nothing_to_pay" | "provider_failed";

/** A payment cannot be started. The message is written for the customer. */
export class PaymentStartError extends Error {
  constructor(
    readonly code: StartPaymentError,
    message: string,
  ) {
    super(message);
  }
}

export type StartPaymentDeps = {
  /** The signed-in customer's email, from their session. The provider needs it for the receipt. */
  email: string;
  provider?: PaymentProvider;
  baseUrl?: string;
  now?: Date;
  appUrl?: string;
  systemUrl?: string;
};

async function defaults(deps: StartPaymentDeps): Promise<{ provider: PaymentProvider; baseUrl: string }> {
  if (deps.provider && deps.baseUrl) return { provider: deps.provider, baseUrl: deps.baseUrl };
  // Loaded on demand so importing this module never reads the environment.
  const { providers } = await import("@/providers");
  const { loadEnv } = await import("@/lib/env");
  return { provider: deps.provider ?? providers().payment, baseUrl: deps.baseUrl ?? loadEnv().APP_URL };
}

/**
 * Starts one payment attempt for the customer's unpaid order and returns where to send them to pay.
 * The amount is the order's total from the database. Each attempt has its own reference, so a retry after
 * an abandoned page is a new attempt and both stay on record.
 */
export async function startPayment(
  ctx: RequestContext,
  publicCode: string,
  deps: StartPaymentDeps,
): Promise<{ authorizationUrl: string; reference: string }> {
  const { provider, baseUrl } = await defaults(deps);
  const now = deps.now ?? new Date();

  const order = await withRequestContext(
    ctx,
    async (tx) => (await tx.select().from(orders).where(eq(orders.publicCode, publicCode)).limit(1))[0],
    { url: deps.appUrl },
  );
  if (!order) throw new OrderNotFoundError("Order not found");
  if (order.status !== "placed") throw new PaymentStartError("not_payable", "This order is not waiting for payment");
  if (order.expiresAt && order.expiresAt.getTime() <= now.getTime()) {
    throw new PaymentStartError("expired", "This order has expired. Please place it again");
  }
  if (order.totalMinor <= 0) throw new PaymentStartError("nothing_to_pay", "This order has nothing to pay");

  const reference = `ord-${order.publicCode}-${randomBytes(5).toString("hex")}`;
  const sys = { url: deps.systemUrl };
  await withSystemContext(
    (tx) =>
      tx.insert(payments).values({
        orderId: order.id,
        provider: provider.name,
        reference,
        amountMinor: order.totalMinor,
        currency: order.currency,
      }),
    sys,
  );

  try {
    const init = await provider.initialize({
      orderId: order.id,
      amountMinor: order.totalMinor,
      email: deps.email,
      reference,
      callbackUrl: `${baseUrl.replace(/\/$/, "")}/orders/${order.publicCode}`,
    });
    return { authorizationUrl: init.authorizationUrl, reference };
  } catch (err) {
    await withSystemContext((tx) => tx.update(payments).set({ status: "failed" }).where(eq(payments.reference, reference)), sys);
    console.error("payment initialize failed", err instanceof Error ? err.message : err);
    throw new PaymentStartError("provider_failed", "We could not reach the payment service. Try again in a moment.");
  }
}
