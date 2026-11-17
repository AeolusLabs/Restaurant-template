import { headers } from "next/headers";
import { text } from "./form";
import { verifyTurnstile } from "./turnstile";

export const HUMAN_CHECK_FAILED = "We could not confirm you are not a bot. Please complete the check and try again.";

/** Verifies the Turnstile answer that came with a submitted form. True when the check is switched off. */
export async function passesHumanCheck(form: FormData): Promise<boolean> {
  const h = await headers();
  // Cloudflare puts the visitor's address in cf-connecting-ip.
  const remoteIp = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  return verifyTurnstile(text(form, "cf-turnstile-response"), { remoteIp });
}
