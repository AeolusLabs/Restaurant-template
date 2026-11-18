import { afterAll, afterEach, describe, expect, inject, test, vi } from "vitest";
import { closePools, listenTo } from "../src/db/context";
import { transitionOrder } from "../src/db/transition-order";
import { StreamHub } from "../src/realtime/hub";
import { authorizeStream, createOrderStream } from "../src/realtime/sse";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
afterEach(() => vi.useRealTimers());

describe("the order_events trigger", () => {
  test("a status change sends one notification with the order and its new status", async () => {
    const got: string[] = [];
    const listener = listenTo("order_events", (p) => got.push(p), { url: urls.app });
    await listener.ready;
    try {
      const { userId } = await makeUser("customer");
      const { orderId } = await makeOrder(userId, "placed");
      await transitionOrder({ orderId, to: "paid", actor: { type: "system" } }, { systemUrl: urls.system });
      // Other test files change orders in the same database, so wait for this order's own message.
      const mine = () => got.map((g) => JSON.parse(g)).filter((m) => m.order_id === orderId);
      await vi.waitFor(() => expect(mine()).toHaveLength(1), { timeout: 5000 });
      expect(mine()).toEqual([{ order_id: orderId, to: "paid" }]);
    } finally {
      await listener.stop();
    }
  });

  test("a change that is rolled back sends nothing", async () => {
    const got: string[] = [];
    const listener = listenTo("order_events", (p) => got.push(p), { url: urls.app });
    await listener.ready;
    try {
      const { userId } = await makeUser("customer");
      const { orderId } = await makeOrder(userId, "placed");
      const c = await admin().connect();
      try {
        await c.query("begin");
        await c.query(`insert into order_events (order_id, from_status, to_status, actor_type) values ($1, 'placed', 'paid', 'system')`, [orderId]);
        await c.query("rollback");
      } finally {
        c.release();
      }
      await new Promise((r) => setTimeout(r, 300));
      expect(got.map((g) => JSON.parse(g)).filter((m) => m.order_id === orderId)).toEqual([]);
    } finally {
      await listener.stop();
    }
  });
});

describe("StreamHub", () => {
  test("delivers a message to every subscriber, and stops delivering after unsubscribe", () => {
    const hub = new StreamHub<string>();
    const a: string[] = [];
    const b: string[] = [];
    const offA = hub.subscribe((m) => a.push(m));
    hub.subscribe((m) => b.push(m));
    hub.publish("one");
    offA();
    hub.publish("two");
    expect(a).toEqual(["one"]);
    expect(b).toEqual(["one", "two"]);
    expect(hub.size).toBe(1);
  });

  test("a subscriber that throws is dropped and does not stop the others", () => {
    const hub = new StreamHub<string>();
    const seen: string[] = [];
    hub.subscribe(() => {
      throw new Error("closed");
    });
    hub.subscribe((m) => seen.push(m));
    hub.publish("x");
    hub.publish("y");
    expect(seen).toEqual(["x", "y"]);
    expect(hub.size).toBe(1);
  });
});

describe("authorizeStream", () => {
  test("only signed-in staff may listen", () => {
    expect(authorizeStream(null)).toBe(401);
    expect(authorizeStream("customer")).toBe(403);
    for (const r of ["kitchen", "manager", "owner"] as const) expect(authorizeStream(r)).toBeNull();
  });
});

describe("createOrderStream", () => {
  const decoder = new TextDecoder();
  async function read(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const { value } = await reader.read();
    return decoder.decode(value);
  }

  test("starts with a comment, sends each order change as an event, and unsubscribes when the viewer leaves", async () => {
    const hub = new StreamHub<{ order_id: string; to: string }>();
    const abort = new AbortController();
    const reader = createOrderStream(hub, abort.signal, { heartbeatMs: 25_000 }).getReader();
    expect(await read(reader)).toBe("retry: 3000\n\n");
    expect(hub.size).toBe(1);
    hub.publish({ order_id: "abc", to: "paid" });
    expect(await read(reader)).toBe('event: order\ndata: {"order_id":"abc","to":"paid"}\n\n');
    abort.abort();
    expect(hub.size).toBe(0);
  });

  test("sends a comment every 25 seconds so an idle connection is not closed by a proxy", async () => {
    vi.useFakeTimers();
    const hub = new StreamHub<unknown>();
    const abort = new AbortController();
    const reader = createOrderStream(hub, abort.signal, { heartbeatMs: 25_000 }).getReader();
    await reader.read(); // retry line
    const next = reader.read();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(decoder.decode((await next).value)).toBe(": keep-alive\n\n");
    abort.abort();
  });

  test("stops its timer when the viewer leaves", async () => {
    vi.useFakeTimers();
    const hub = new StreamHub<unknown>();
    const abort = new AbortController();
    createOrderStream(hub, abort.signal, { heartbeatMs: 1000 });
    abort.abort();
    expect(vi.getTimerCount()).toBe(0);
  });
});
