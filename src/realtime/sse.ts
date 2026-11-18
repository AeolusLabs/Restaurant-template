import type { AppRole } from "@/domain/roles";
import type { StreamHub } from "./hub";

/** 401 when nobody is signed in, 403 for a customer, null when the person may listen. */
export function authorizeStream(role: AppRole | null): 401 | 403 | null {
  if (role === null) return 401;
  return role === "customer" ? 403 : null;
}

const encoder = new TextEncoder();

/**
 * A Server-Sent Events body: each message on the hub becomes an "order" event, and a comment goes out every
 * heartbeatMs (25 seconds by default) so Cloudflare and other proxies do not close an idle connection. When the
 * viewer leaves (the signal aborts) it unsubscribes and stops its timer.
 */
export function createOrderStream(hub: StreamHub<unknown>, signal: AbortSignal, opts: { heartbeatMs?: number } = {}): ReadableStream<Uint8Array> {
  let cleanup = () => {};
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      send("retry: 3000\n\n");
      const off = hub.subscribe((message) => send(`event: order\ndata: ${JSON.stringify(message)}\n\n`));
      const timer = setInterval(() => send(": keep-alive\n\n"), opts.heartbeatMs ?? 25_000);
      cleanup = () => {
        off();
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      if (signal.aborted) cleanup();
      else signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });
}
