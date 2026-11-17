import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { closePools } from "../src/db/context";
import { staffTransitionOrder } from "../src/db/staff-actions";
import type { OrderStatus } from "../src/domain/orders/statuses";
import { ConcurrentTransitionError, IllegalTransitionError, OrderNotFoundError } from "../src/domain/orders/transitions";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const opts = { appUrl: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

async function order(status: OrderStatus = "paid") {
  const { orderId } = await makeOrder((await makeUser("customer")).userId, status);
  const code = (await admin().query(`select public_code from orders where id = $1`, [orderId])).rows[0].public_code as string;
  return { orderId, code };
}
const statusOf = async (id: string) => (await admin().query(`select status from orders where id = $1`, [id])).rows[0].status as string;
const audits = async (code: string) => (await admin().query(`select action, actor_role, meta from audit_log where target_id = $1 order by created_at`, [code])).rows;

describe("staffTransitionOrder", () => {
  test("the kitchen walks an order from paid to handed over, each step recorded against the person who did it", async () => {
    const { ctx, userId } = await makeUser("kitchen");
    const { orderId, code } = await order("paid");
    let from: OrderStatus = "paid";
    for (const to of ["accepted", "preparing", "ready", "picked_up"] as const) {
      expect(await staffTransitionOrder(ctx, code, to, { expectedFrom: from }, opts)).toEqual({ status: to });
      from = to;
    }
    const events = (await admin().query(`select to_status, actor_type, actor_id from order_events where order_id = $1 order by created_at`, [orderId])).rows;
    expect(events.map((e) => e.to_status)).toEqual(["accepted", "preparing", "ready", "picked_up"]);
    expect(events.every((e) => e.actor_type === "staff" && e.actor_id === userId)).toBe(true);
  });

  test("the kitchen cannot cancel, and the order is left as it was", async () => {
    const { ctx } = await makeUser("kitchen");
    const { orderId, code } = await order("paid");
    await expect(staffTransitionOrder(ctx, code, "cancelled", {}, opts)).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await statusOf(orderId)).toBe("paid");
  });

  test("a manager can cancel, and management actions are written to the audit log", async () => {
    const { ctx } = await makeUser("manager");
    const { orderId, code } = await order("paid");
    await staffTransitionOrder(ctx, code, "cancelled", { expectedFrom: "paid", reason: "out of rice" }, opts);
    expect(await statusOf(orderId)).toBe("cancelled");
    expect(await audits(code)).toEqual([{ action: "order.cancelled", actor_role: "manager", meta: { from: "paid", to: "cancelled", reason: "out of rice" } }]);
    expect((await admin().query(`select reason from order_events where order_id = $1`, [orderId])).rows[0].reason).toBe("out of rice");
  });

  test("a manager completing a collected order is audited too", async () => {
    const { ctx } = await makeUser("owner");
    const { code } = await order("picked_up");
    await staffTransitionOrder(ctx, code, "completed", {}, opts);
    expect((await audits(code)).map((a) => a.action)).toEqual(["order.completed"]);
  });

  test("routine kitchen steps are not added to the audit log, because the order history already has them", async () => {
    const { ctx } = await makeUser("kitchen");
    const { code } = await order("paid");
    await staffTransitionOrder(ctx, code, "accepted", {}, opts);
    expect(await audits(code)).toEqual([]);
  });

  test("a screen showing an old status is told so, instead of acting on a stale picture", async () => {
    const { ctx } = await makeUser("manager");
    const { code } = await order("accepted");
    await expect(staffTransitionOrder(ctx, code, "accepted", { expectedFrom: "paid" }, opts)).rejects.toBeInstanceOf(ConcurrentTransitionError);
  });

  test("two people accepting the same order at once: one succeeds, the other is told it was already done", async () => {
    const [a, b] = [await makeUser("kitchen"), await makeUser("manager")];
    const { orderId, code } = await order("paid");
    const results = await Promise.allSettled([
      staffTransitionOrder(a.ctx, code, "accepted", { expectedFrom: "paid" }, opts),
      staffTransitionOrder(b.ctx, code, "accepted", { expectedFrom: "paid" }, opts),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(ConcurrentTransitionError);
    expect(await statusOf(orderId)).toBe("accepted");
    expect((await admin().query(`select 1 from order_events where order_id = $1`, [orderId])).rowCount).toBe(1);
  });

  test("an order the person cannot see, or that does not exist, is not found", async () => {
    const { ctx } = await makeUser("kitchen");
    const hidden = await order("placed"); // the kitchen cannot see unpaid orders
    await expect(staffTransitionOrder(ctx, hidden.code, "accepted", {}, opts)).rejects.toBeInstanceOf(OrderNotFoundError);
    await expect(staffTransitionOrder(ctx, "NOSUCHCODE", "accepted", {}, opts)).rejects.toBeInstanceOf(OrderNotFoundError);
  });

  test("a customer account cannot use it at all", async () => {
    const { ctx } = await makeUser("customer");
    const { code } = await order("paid");
    await expect(staffTransitionOrder(ctx, code, "accepted", {}, opts)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
