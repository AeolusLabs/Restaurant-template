import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { closePools } from "../src/db/context";
import {
  ConcurrentTransitionError,
  IllegalTransitionError,
  OrderNotFoundError,
  TRANSITIONS,
  actorKey,
  canTransition,
  type Actor,
  type ActorKey,
  type TransitionRule,
} from "../src/domain/orders/transitions";
import { transitionOrder } from "../src/db/transition-order";
import { ORDER_STATUSES, type Fulfilment, type OrderStatus } from "../src/domain/orders/statuses";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const opts = { appUrl: urls.app, systemUrl: urls.system };

let customer: { userId: string };
let other: { userId: string };
let actors: Record<ActorKey, Actor>;

beforeAll(async () => {
  const [c, o, k, m, ow] = await Promise.all([
    makeUser("customer"),
    makeUser("customer"),
    makeUser("kitchen"),
    makeUser("manager"),
    makeUser("owner"),
  ]);
  customer = c;
  other = o;
  actors = {
    customer: { type: "customer", id: c.userId },
    kitchen: { type: "staff", id: k.userId, role: "kitchen" },
    manager: { type: "staff", id: m.userId, role: "manager" },
    owner: { type: "staff", id: ow.userId, role: "owner" },
    system: { type: "system" },
  };
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

const scopes = (r: TransitionRule): Fulfilment[] => (r.fulfilment ? [r.fulfilment] : ["pickup", "delivery"]);
const allowed = (from: OrderStatus, to: OrderStatus) => TRANSITIONS.some((r) => r.from === from && r.to === to);

async function orderAt(status: OrderStatus, fulfilment: Fulfilment = "pickup", resume?: OrderStatus) {
  const { orderId } = await makeOrder(customer.userId, status, fulfilment);
  if (resume) await admin().query(`update orders set resume_state = $1 where id = $2`, [resume, orderId]);
  return orderId;
}
const statusOf = async (id: string) => (await admin().query(`select status, resume_state from orders where id = $1`, [id])).rows[0];
const events = async (id: string) => (await admin().query(`select * from order_events where order_id = $1 order by created_at, id`, [id])).rows;

describe("the matrix in TypeScript", () => {
  test("canTransition agrees with TRANSITIONS for every status pair, actor and fulfilment", () => {
    for (const from of ORDER_STATUSES)
      for (const to of ORDER_STATUSES)
        for (const f of ["pickup", "delivery"] as Fulfilment[])
          for (const key of Object.keys(actors) as ActorKey[]) {
            const expected = TRANSITIONS.some(
              (r) => r.from === from && r.to === to && r.actors.includes(key) && (!r.fulfilment || r.fulfilment === f),
            );
            expect(canTransition(from, to, f, actors[key]), `${from}->${to} ${f} ${key}`).toBe(expected);
          }
  });

  test("actorKey maps staff by role", () => {
    expect(actorKey({ type: "staff", id: "x", role: "kitchen" })).toBe("kitchen");
    expect(actorKey({ type: "customer", id: "x" })).toBe("customer");
    expect(actorKey({ type: "system" })).toBe("system");
  });
});

describe("transitionOrder against the database", () => {
  test("every rule in TRANSITIONS succeeds for each allowed actor", async () => {
    for (const rule of TRANSITIONS) {
      for (const f of scopes(rule)) {
        for (const key of rule.actors) {
          const resume = rule.from === "delivery_failed" && rule.to !== "cancelled" ? rule.to : undefined;
          const id = await orderAt(rule.from, f, resume);
          const res = await transitionOrder({ orderId: id, to: rule.to, actor: actors[key] }, opts);
          expect(res.status, `${rule.from}->${rule.to} ${f} ${key}`).toBe(rule.to);
          expect((await statusOf(id)).status).toBe(rule.to);
        }
      }
    }
  });

  test("every other from-to pair among the 11 statuses is rejected, for every actor", async () => {
    for (const from of ORDER_STATUSES)
      for (const to of ORDER_STATUSES) {
        if (allowed(from, to)) continue;
        for (const key of ["owner", "system"] as ActorKey[]) {
          const id = await orderAt(from, "delivery");
          await expect(transitionOrder({ orderId: id, to, actor: actors[key] }, opts), `${from}->${to} ${key}`).rejects.toBeInstanceOf(
            IllegalTransitionError,
          );
          expect((await statusOf(id)).status).toBe(from);
        }
      }
  });

  test("kitchen cannot cancel, a customer can cancel placed or paid only, and not someone else's order", async () => {
    await expect(transitionOrder({ orderId: await orderAt("paid"), to: "cancelled", actor: actors.kitchen }, opts)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    for (const ok of ["placed", "paid"] as OrderStatus[]) {
      await expect(transitionOrder({ orderId: await orderAt(ok), to: "cancelled", actor: actors.customer }, opts)).resolves.toEqual({
        status: "cancelled",
      });
    }
    await expect(transitionOrder({ orderId: await orderAt("accepted"), to: "cancelled", actor: actors.customer }, opts)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    const theirs = await orderAt("placed");
    await expect(
      transitionOrder({ orderId: theirs, to: "cancelled", actor: { type: "customer", id: other.userId } }, opts),
    ).rejects.toBeInstanceOf(IllegalTransitionError);
    expect((await statusOf(theirs)).status).toBe("placed");
  });

  test("ready to picked_up is pickup only, and ready to out_for_delivery is delivery only", async () => {
    const asKitchen = actors.kitchen;
    await expect(transitionOrder({ orderId: await orderAt("ready", "delivery"), to: "picked_up", actor: asKitchen }, opts)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    await expect(transitionOrder({ orderId: await orderAt("ready", "pickup"), to: "out_for_delivery", actor: actors.system }, opts)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    await expect(transitionOrder({ orderId: await orderAt("ready", "pickup"), to: "picked_up", actor: asKitchen }, opts)).resolves.toEqual({ status: "picked_up" });
  });

  test("delivery_failed is for delivery orders only", async () => {
    await expect(transitionOrder({ orderId: await orderAt("accepted", "pickup"), to: "delivery_failed", actor: actors.system }, opts)).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  test("delivery_failed returns only to the stored resume_state, or goes to cancelled", async () => {
    const id = await orderAt("preparing", "delivery");
    await transitionOrder({ orderId: id, to: "delivery_failed", actor: actors.system }, opts);
    expect(await statusOf(id)).toEqual({ status: "delivery_failed", resume_state: "preparing" });

    await expect(transitionOrder({ orderId: id, to: "ready", actor: actors.manager }, opts)).rejects.toBeInstanceOf(IllegalTransitionError);
    await expect(transitionOrder({ orderId: id, to: "preparing", actor: actors.kitchen }, opts)).rejects.toBeInstanceOf(IllegalTransitionError);
    await transitionOrder({ orderId: id, to: "preparing", actor: actors.manager }, opts);
    expect(await statusOf(id)).toEqual({ status: "preparing", resume_state: null });

    const giveUp = await orderAt("ready", "delivery");
    await transitionOrder({ orderId: giveUp, to: "delivery_failed", actor: actors.system }, opts);
    await transitionOrder({ orderId: giveUp, to: "cancelled", actor: actors.owner }, opts);
    expect((await statusOf(giveUp)).status).toBe("cancelled");
  });

  test("an unknown order id throws OrderNotFoundError", async () => {
    await expect(
      transitionOrder({ orderId: "0194f3c0-0000-7000-8000-0000000000ff", to: "paid", actor: actors.system }, opts),
    ).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  test("each transition writes exactly one order_events row with from, to, actor type and actor id", async () => {
    const id = await orderAt("paid");
    await transitionOrder({ orderId: id, to: "accepted", actor: actors.manager, reason: "ok", meta: { via: "test" } }, opts);
    const rows = await events(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from_status: "paid", to_status: "accepted", actor_type: "staff", actor_id: (actors.manager as { id: string }).id, reason: "ok", meta: { via: "test" } });

    const sys = await orderAt("placed");
    await transitionOrder({ orderId: sys, to: "paid", actor: actors.system }, opts);
    expect((await events(sys))[0]).toMatchObject({ actor_type: "system", actor_id: null });
  });

  test("a rejected transition writes no event", async () => {
    const id = await orderAt("placed");
    await expect(transitionOrder({ orderId: id, to: "completed", actor: actors.owner }, opts)).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await events(id)).toHaveLength(0);
  });

  test("two simultaneous accepts: one succeeds, the other throws, and one event row exists", async () => {
    const id = await orderAt("paid");
    const results = await Promise.allSettled([
      transitionOrder({ orderId: id, to: "accepted", actor: actors.manager, expectedFrom: "paid" }, opts),
      transitionOrder({ orderId: id, to: "accepted", actor: actors.owner, expectedFrom: "paid" }, opts),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(ConcurrentTransitionError);
    expect(await events(id)).toHaveLength(1);
    expect((await statusOf(id)).status).toBe("accepted");
  });

  test("two simultaneous accepts without expectedFrom: the loser is an illegal transition", async () => {
    const id = await orderAt("paid");
    const results = await Promise.allSettled([
      transitionOrder({ orderId: id, to: "accepted", actor: actors.manager }, opts),
      transitionOrder({ orderId: id, to: "accepted", actor: actors.owner }, opts),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(IllegalTransitionError);
    expect(await events(id)).toHaveLength(1);
  });

  test("expectedFrom that no longer matches throws ConcurrentTransitionError and changes nothing", async () => {
    const id = await orderAt("accepted");
    await expect(
      transitionOrder({ orderId: id, to: "preparing", actor: actors.kitchen, expectedFrom: "paid" }, opts),
    ).rejects.toBeInstanceOf(ConcurrentTransitionError);
    expect((await statusOf(id)).status).toBe("accepted");
    expect(await events(id)).toHaveLength(0);
  });
});

describe("the database backstop", () => {
  test("a direct UPDATE of orders.status that is not in order_transitions is rejected by the trigger", async () => {
    const id = await orderAt("placed");
    await expect(admin().query(`update orders set status = 'completed' where id = $1`, [id])).rejects.toThrow(/illegal order transition/i);
    expect((await statusOf(id)).status).toBe("placed");
  });

  test("the system role cannot skip the matrix with a direct UPDATE either", async () => {
    const id = await orderAt("placed");
    const { Client } = await import("pg");
    const c = new Client({ connectionString: urls.system });
    await c.connect();
    try {
      await c.query("begin");
      await c.query(`select set_config('app.role', 'system', true)`);
      await expect(c.query(`update orders set status = 'completed' where id = $1`, [id])).rejects.toThrow(/illegal order transition/i);
      await c.query("rollback");
    } finally {
      await c.end();
    }
  });

  test("the app role gets a permission error on UPDATE orders", async () => {
    const { Client } = await import("pg");
    const c = new Client({ connectionString: urls.app });
    await c.connect();
    try {
      await expect(c.query(`update orders set status = 'paid'`)).rejects.toThrow(/permission denied/);
    } finally {
      await c.end();
    }
  });

  test("TRANSITIONS equals the rows seeded in order_transitions, in both directions", async () => {
    const { rows } = await admin().query(`select from_status, to_status, fulfilment_scope, actors from order_transitions`);
    const db = new Set(rows.flatMap((r) => (r.actors as string[]).map((a) => `${r.from_status}|${r.to_status}|${r.fulfilment_scope}|${a}`)));
    const ts = new Set(TRANSITIONS.flatMap((r) => r.actors.map((a) => `${r.from}|${r.to}|${r.fulfilment ?? "any"}|${a}`)));
    expect([...db].sort()).toEqual([...ts].sort());
  });
});
