# Phase 9 build log

The four remaining agents, demo mode, `seed:demo` and a simulated live order stream. Plan: `docs/superpowers/plans/2026-11-18-phase-9-demo-and-agents.md`. Built inline on branch `phase-9-demo-agents` (cut from `phase-8-agents`), test first, one commit per task. Final state: 87 test files, 1071 tests passing, typecheck, lint and production build clean. No new migration: demo data uses the existing tables, so the database is still at 0027.

## What exists

- **Four operations agents** (`src/agents/ops-agents.ts`, rules in `src/domain/agents/ops.ts`). All are rule-based, so they cost nothing and behave the same every time, and they only propose.
  - **Demand and prep planner** (daily): a note for tomorrow, from the same weekday in recent weeks: expected paid orders, the busiest hour, the three most-ordered dishes. It says nothing when it has fewer than two such days of history, or when tomorrow is a closed day.
  - **Menu engineer** (weekly): suggests hiding a dish that has not sold in a long time (default 60 days). Never while the restaurant is quiet overall (under 20 paid orders in the window), never a dish younger than the window, and not the same dish again within 90 days. Hiding is reversible from Admin, Menu.
  - **Delivery watchdog** (every 10 minutes): raises an alert for a delivery that is stuck: a booking that has failed and still waits, no rider assigned, not collected, or on the road too long. Each threshold is a setting. The same delivery in the same state is not raised again within six hours.
  - **Anomaly and abuse detector** (every 6 hours): suggests blocking a customer with several refunds in 30 days, or several orders let expire unpaid in a day, with the evidence in the suggestion. This counts as customer-facing, so it can never run on its own without an owner's SEND confirmation, and a blocked or non-customer account is never proposed again. A person decides.
- **Settings for them** come from one table (`src/agents/settings-fields.ts`): the agent's schema, the owner's form on `/admin/agents/[key]` and the form's checking are all made from it, so a number has one definition (label, help text, range, default).
- **Demo mode.** With `features.demo_mode` on:
  - **Boot refuses** to start with any real provider (payment, delivery, notification or model), naming each one. Fictional orders must never reach real money or people.
  - **`pnpm db:seed:demo`** adds 12 fictional customers (`demo.N@demo.invalid`, no password, so no one can sign in as them), two weeks of order history shaped like a real restaurant (lunch and dinner peaks, busier Fridays and Saturdays, none on closed days, mostly completed, some unpaid and cancelled, a few refunded), a promo (DEMO10) and a QR source with scans, each customer's consents, and the menu. It needs `DATABASE_ADMIN_URL`, only runs with `demo_mode` on, **refuses if the database holds any order that is not a demo order**, and is safe to re-run: it removes its own earlier data first, in one transaction.
  - **A banner** on every screen says it is a demo.
  - **A live stream** (worker job `demo-orders`, every 20 seconds). Each tick may place an order as a fictional customer and pay it through the mock, and moves each fictional order on one step with a fictional "Demo Kitchen" account. It places orders through `createPickupOrder` and `createDeliveryOrder`, pays through `startPayment`, the mock payment and the real webhook handler, moves orders with `staffTransitionOrder` and `transitionOrder`, and delivery goes through the real dispatch and sync jobs with the mock rider. It only touches orders made by fictional customers, so a real order is never moved. It refuses to run against a real provider.

## Rulings

The plan's eight rulings stand. Added while building:

- **The stream is quiet while the restaurant is closed,** because a real customer could not order either. The seeded history fills the quiet hours, but a showcase looked at at 3 a.m. shows no live activity. Changing this would mean letting demo orders be placed out of hours, which the real checkout forbids.
- **Seeded history is pickup only.** A finished delivery order needs a delivery record with a provider reference; making those up would be inventing provider data. Delivery orders appear from the live stream when delivery is on.
- **The seeded history logs only transitions,** like a real order: the first event is "paid" or "cancelled". (An early version added an arrival event; the stream test showed real orders do not have one.)
- **`seedDemo` takes a database handle,** and the script and the test make the connection, so only `src/db/context.ts` imports the pg `Pool` (an architecture test enforces that).
- **Notes are acknowledged, not executed.** Approving a demand note records that someone read it.

## Found by the tests

- The database driver expands a JavaScript array into separate parameters, so an `in (...)` list of dates needed `sql.join`.
- A test that hard-coded a weekday broke on another day; it now works the weekday out.
- Tests in different files shared the menu and the delivery table, so the menu test hides its items afterwards and the watchdog test uses early years no other data uses.
- The first version of the seed built its own pg connection; the architecture test failed and the seed was changed to take one.
- The stream test showed that a real order has no "placed" event; the seed was corrected to match.
- One assertion counted every order in a database that parallel test files write to; it now looks only at its own order.
- Mutation checks (deliberately breaking the real-orders guard, the refund status and the demo-only filter) each made tests fail, so those tests check what they claim.

## Process slips

- The first commit of T3 went in while one architecture test was failing, because my command chained the commit after a test run that I had not gated on. The next commit fixed it. Later commits were gated on real exit codes.
- The demo banner and the `seed:demo` script have no unit tests of their own (the seed function is tested; the script is a thin wrapper, and the banner was checked live).

## Verified live (real database, mock providers)

On a throwaway database in the dev cluster (since dropped), with demo mode, delivery, promos and agents switched on temporarily (config reverted): migrations applied, `pnpm db:seed:demo` made 12 customers and 95 orders (87 paid, 8 unpaid and cancelled, 4 refunded), and running it again replaced them rather than doubling them. With the worker running, the stream placed orders, paid them through the mock, moved them through the kitchen steps, queued and booked deliveries and advanced the mock rider, about one order every 20 seconds. The demo banner appeared on the home, menu and sign-in pages. The four agents ran once against the seeded data: the demand planner proposed "Tomorrow, Thursday: about 5 orders ... busiest around 12:00. Most ordered: Fried Rice, Pepper Soup, Zobo", and the other three correctly proposed nothing (nothing stale, nothing stuck, no abusive pattern).

## Not verified

- **The new agents' settings screens and the demo banner in a browser.** I checked the banner's text in the served pages, and tested the form parsing, but did not sign in and look at `/admin/agents/[key]` or the banner at phone width.
- **The kitchen screen and dashboard with demo data on screen.** The data is right (counts, statuses, events); I did not look at the pages.
- **A real deployment.** Nothing was deployed. A demo on Railway has not been tried.
- **A visitor placing and paying a demo order through the web app** while the worker runs (see the first known gap).
- **Two workers** running the stream at once.
- Everything still unverified from earlier phases (Chowdeck, Paystack, a real language model, a real WhatsApp provider, Railway, Cloudflare, PgBouncer, Docker).

## Known gaps

- **The mock payment provider is in memory, per process.** In a demo, a visitor's order is paid on the web app's mock page and works. But if a visitor abandons an order, the worker's expiry job asks its own mock provider about a payment it has never heard of, cannot get an answer, and leaves the order as it is, so abandoned visitor orders can stay "placed". The stream's own abandoned orders have no payment attempt, so those do expire. A real provider has no such problem.
- Rows the demo made in other tables (agent proposals about demo customers, audit entries) are not removed by a re-seed; only orders, payments, customers, the promo and the QR source are.
- The stream's pace and mix (45% of ticks place an order, a tenth are abandoned, about a third are delivery when it is on) are defaults in code, not settings.
- The seeded history is fixed at two weeks, relative to the day it runs. Agents that look back further (win-back's 45 days) find nothing to propose on a fresh demo.
