import { listenTo } from "@/db/context";
import { StreamHub } from "./hub";

export type OrderEventMessage = { order_id: string; to: string };

// One listener and one hub per web process, shared by every open stream. Started on first use, kept on
// globalThis so a development reload does not leave a second listener running.
const holder = globalThis as typeof globalThis & { __orderHub?: StreamHub<OrderEventMessage>; __orderListener?: { stop(): Promise<void> } };

/** The hub that order-change messages arrive on, with the database listener started. */
export function orderEvents(): StreamHub<OrderEventMessage> {
  holder.__orderHub ??= new StreamHub<OrderEventMessage>();
  const hub = holder.__orderHub;
  holder.__orderListener ??= listenTo("order_events", (payload) => {
    try {
      const m = JSON.parse(payload) as OrderEventMessage;
      if (typeof m.order_id === "string" && typeof m.to === "string") hub.publish({ order_id: m.order_id, to: m.to });
    } catch {
      // A malformed message is ignored; screens also poll.
    }
  });
  return hub;
}
