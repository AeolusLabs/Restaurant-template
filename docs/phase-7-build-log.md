# Phase 7 build log

The BI dashboard. Plan: `docs/superpowers/plans/2026-11-18-phase-7-dashboard.md`. Built inline on branch `phase-7-dashboard` (cut from `phase-6-qr-codes`), test first, one commit per task. Final state: 72 test files, 814 tests passing, typecheck, lint and production build clean. No new migrations and no new tables: the dashboard only reads.

## What exists

`/admin/dashboard` (owners and managers), for the last 7, 30 or 90 days:

- **Sales.** One headline figure, the number of orders and the average, the change against the same number of days before (with an arrow and words, never colour alone), refunds shown separately, and a column chart of sales for each day.
- **Busiest times.** A heatmap of orders by weekday and hour in the restaurant's timezone, with a sentence naming the busiest hour.
- **Customers coming back.** How many of the customers who ordered had ordered before, and how many were new.
- **Best sellers.** The five dishes sold most, by quantity.
- **Does delivery pay for itself?** (only when delivery is on) What customers paid for delivery against what the riders cost. When the riders cost more, a plain warning says by how much, per delivery, and what to change.
- **Promo codes.** (only when promos are on) What the codes took off, and a link to manage them.
- Every chart has a "Show as a table" view. Nothing is estimated: each figure is a count or a sum of rows, and an empty period says so.

## Rulings

The plan's eight rulings stand. Added while building:

- **Sales are measured when the payment succeeded,** not when the order was placed, in the restaurant's timezone, so a late-night order lands on the right day. The tests use a payment at 23:30 UTC that is 00:30 the next day in Lagos.
- **An earlier order that was later refunded still means the customer has ordered before,** so they count as returning.
- **Delivery costs count only deliveries that have a rider cost and were not cancelled, failed or still queued.**
- **The hero figure is 48px from tablet width up and 36px on a phone.** The dataviz guidance asks for 48px or more, but a figure like ₦1,180,520.00 does not fit a phone card at that size (found in the browser: it was clipped).
- **Chart colours are fixed, not the restaurant's brand colour,** because a brand colour has not been validated for colour-blind readers. The two series colours (`#2a78d6`, `#eb6834`) pass every check of the dataviz validator (colour-vision separation 24.7, contrast over 3:1); the heatmap is one blue ramp.
- **Light only,** like the rest of the app.

## Verified live

With 221 synthetic orders (marked, added for the check, removed afterwards): the page rendered with every section; the numbers matched the data's shape (busy Fridays and weekday lunch and evening peaks; delivery cost deliberately set a little above fees, which produced the warning); the column chart, heatmap, segmented bar and ranked bars looked right at desktop width; the hero figure was found clipped at phone width and fixed; and at an emulated 375px width nothing overflowed.

## Not verified

- **A real phone.** The browser window could not be resized, so the 375px check was an emulation (the page's width was constrained), and the phone-size hero (36px) was measured by setting the size directly rather than by a real narrow viewport.
- **With a restaurant's real data.** The numbers have only met tests and synthetic orders.
- **Hover tooltips on a touch screen,** and the table views with a screen reader.
- **A very large month.** The queries read every paid order in the window; there are no indexes added for this. Fine for a restaurant, to be measured at volume.
- **Dark mode** does not exist in the app.
- Test discipline: the scale helper's tests and code were written in one step, so I did not watch those fail first.
- Everything still unverified from earlier phases (Chowdeck, Paystack, Railway, Cloudflare, PgBouncer, Docker).

## Known gaps

- Hover shows the browser's own tooltip, not a custom crosshair.
- No export (CSV), no custom date range, no comparison with the same weekday, and no per-hour staffing advice beyond naming the busiest hour.
- Repeat customers are only the new against returning split. There is no lifetime value or cohort view.
- Delivery economics ignore wallet top-up fees and the cost of refunded deliveries.
- The QR source report stays on its own page; sales by source are not on the dashboard.
