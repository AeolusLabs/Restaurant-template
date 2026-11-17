import { validateBoot } from "@/lib/boot";

// Runs once when the server starts. A bad environment or config stops the server with a readable message,
// instead of failing on the first request that happens to need it.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") validateBoot();
}
