// Rules for the operations agents. Pure: no database, no HTTP, no model.

export type DemandCell = { date: string; hour: number; orders: number };
export type DemandPlan = { expectedOrders: number; busiestHour: number | null; topItems: { name: string; perDay: number }[] };

/**
 * What to expect on a day of the week from the same weekday in recent weeks. `dayCount` is how many such days had
 * any history; with fewer than two there is not enough to say anything, so there is no plan rather than a guess.
 */
export function planDemand(input: { cells: DemandCell[]; items: { name: string; quantity: number }[]; dayCount: number }): DemandPlan | null {
  if (input.dayCount < 2) return null;
  const total = input.cells.reduce((n, c) => n + c.orders, 0);
  if (total <= 0) return null;
  const byHour = new Map<number, number>();
  for (const c of input.cells) byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.orders);
  let busiestHour: number | null = null;
  for (const [hour, n] of [...byHour].sort((a, b) => a[0] - b[0])) if (busiestHour === null || n > (byHour.get(busiestHour) ?? 0)) busiestHour = hour;
  const topItems = [...input.items]
    .filter((i) => i.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((i) => ({ name: i.name, perDay: Math.max(1, Math.round(i.quantity / input.dayCount)) }));
  return { expectedOrders: Math.ceil(total / input.dayCount), busiestHour, topItems };
}

export type WatchThresholds = { queuedMinutes: number; awaitingMinutes: number; transitMinutes: number };

/** Why a delivery looks stuck, or null when it does not. `minutes` is how long it has been in its current status. */
export function stuckReason(d: { status: string; attempts: number; minutes: number }, t: WatchThresholds): string | null {
  const m = Math.round(d.minutes);
  switch (d.status) {
    case "queued":
      return d.attempts >= 1 && d.minutes >= t.queuedMinutes ? `Booking a rider has failed ${d.attempts} ${d.attempts === 1 ? "time" : "times"} and the delivery is still waiting after ${m} minutes` : null;
    case "pending":
      return d.minutes >= t.awaitingMinutes ? `No rider has been assigned after ${m} minutes` : null;
    case "awaiting_pickup":
      return d.minutes >= t.awaitingMinutes ? `The rider has not collected the order after ${m} minutes` : null;
    case "in_transit":
      return d.minutes >= t.transitMinutes ? `The delivery has been on the road for ${m} minutes` : null;
    default:
      return null;
  }
}
