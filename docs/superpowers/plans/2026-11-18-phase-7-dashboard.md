# Phase 7: BI dashboard. Implementation plan

> Executed inline, test first, one commit per task, on branch `phase-7-dashboard` (cut from `phase-6-qr-codes`).

**Goal:** An owner or manager opens one page and sees how the restaurant is doing: sales and orders against the period before, which days and hours are busy, whether customers come back, which dishes sell, and whether delivery pays for itself. It works from a phone. Where the numbers say something is wrong, it says what to look at.

**Spec:** `docs/ARCHITECTURE.md` section 18 (BI dashboard); `PRODUCT.md` (owners check revenue, repeat customers, peak hours, delivery cost against delivery fees collected; no cold enterprise tiles, no decorative charts, data that says what to do; responsive on a phone); `CLAUDE.md` (do not invent metrics).

## Global constraints

- Every number comes from the database. Nothing is estimated or invented, and an empty period says so.
- Read-only: no new tables. Queries run as the signed-in manager or owner, so row-level security still decides.
- Charts follow the dataviz skill: forms chosen by the job, validated colours (`#2a78d6` and `#eb6834` pass every check; the blue ramp for the heatmap), thin marks, a legend whenever there are two series, a table view for every chart, nothing coloured by rank.
- The app is light-theme only, so the charts are too.

## Rulings

1. **Sales are paid orders that were not refunded,** counted at the time of payment in the restaurant's timezone. Refunds are shown separately, so a refunded order is never sales.
2. **The period is the last 7, 30 or 90 days including today so far,** compared with the same number of days before it. If the earlier period had no sales, no percentage is shown (not a made-up one).
3. **Peak hours** count those orders by local weekday and hour.
4. **New and returning customers:** a customer is new when their first-ever paid order falls in the period, returning when they had one before it.
5. **Delivery pays for itself, or not:** for sold delivery orders with a booked rider, what customers paid for delivery against what the riders cost. A free-delivery promo shows as nothing collected, because that is what happened.
6. **Best sellers** are by quantity, from the order's own item snapshot, so a renamed dish still counts.
7. **The delivery section appears only when delivery is on, and the promo line only when promos are on.**
8. **Hover shows the browser's own tooltip** (SVG titles) and every chart has a "Show as a table" view; there is no custom crosshair.

## Tasks

- [x] **T1 Pure rules.** `src/domain/dashboard/`: the period windows in the restaurant's timezone, the local day list, change against the previous period, heatmap steps, the sentences.
- [x] **T2 The numbers.** `src/db/dashboard.ts`: sales by day, peak hours, customers, fulfilment, delivery, best sellers, promos, with the previous period's totals.
- [x] **T3 Charts.** Server-rendered SVG: columns, heatmap, ranked bars, segmented bar, each with a table view.
- [x] **T4 The page.** `/admin/dashboard`, the period choice, the nav link, empty states, and what each section says to do.
- [x] **T5 Docs, live check, completion status.**
