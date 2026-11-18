# Phase 9: Remaining agents, demo mode, simulated order stream, `seed:demo`. Implementation plan

> Executed inline, test first, one commit per task, on branch `phase-9-demo-agents` (cut from `phase-8-agents`).

**Goal:** Finish the agent set with four internal agents (demand and prep planner, menu engineer, delivery watchdog, anomaly and abuse detector), and make the template deployable as a showcase: `demo_mode` fills the database with fictional data and runs a simulated live order stream, and can never touch real money or real people.

**Spec:** `docs/ARCHITECTURE.md` sections 15, 18 and `CLAUDE.md` rules 9, 11 (`demo_mode` enables `seed:demo` and a simulated live order stream, so the template can be deployed as a showcase with fictional data).

## Global constraints

- The four agents obey the Phase 8 framework: they only propose, nothing runs without the decision their level calls for, and they work at no AI cost (rule-based, no model).
- Anything about a person (blocking a customer) counts as customer-facing: it never runs automatically without an owner's separate confirmation.
- Demo mode refuses to start with any real provider (payment, delivery, notification or model). Fictional data must never reach real money or real people.
- Demo data is fictional and marked (`@demo.invalid` emails), so it can be found and removed, and `seed:demo` refuses to run in a database that holds real orders.
- The simulated stream goes through the real code paths (placing an order, paying through the mock, the state machine, the delivery jobs), never around them.
- Every migration is applied to the dev database in the same task.

## Rulings

1. **The four agents are rule-based, with thresholds in their settings.** A model would add cost and untestable behaviour to what are counting and comparison jobs. They can still be given the model later.
2. **What each proposes.** Demand planner: a note (tomorrow's expected orders, busiest hour, what to prep) from the same weekday in recent weeks. Menu engineer: hide a dish that has not sold for a long time (a real, reversible change). Delivery watchdog: an alert about a delivery that is stuck. Anomaly detector: block a customer with repeated refunds or many unpaid holds, with the evidence.
3. **A note is acknowledged, not "executed".** Approving an informational note records that you read it. A suggest-only agent's notes can only be dismissed.
4. **The menu engineer never proposes anything while the restaurant is quiet overall** (fewer than 20 paid orders in the window), so a slow month does not hide the whole menu.
5. **Blocking is never proposed on one signal,** and a customer who is already blocked, or is not a customer, is never proposed again.
6. **`seed:demo` needs the privileged connection** (`DATABASE_ADMIN_URL`), like `db:bootstrap`, because it back-dates orders and the app's own roles cannot. It is idempotent: it removes the previous demo data and rebuilds it. It refuses unless `features.demo_mode` is on and the database has no real orders.
7. **The stream is a worker job** (every 20 seconds, only with `demo_mode`): sometimes a demo customer places an order and "pays" through the mock; each live demo order moves one step with some probability, by a fictional demo kitchen account, using the real state machine. Demo deliveries use the real dispatch jobs and the mock rider.
8. **A banner on every screen says it is a demo.**

## Tasks

- [x] **T1 The four agents.** Executors for notes, hiding a dish, raising an alert and blocking a customer; two new alert kinds; each agent with its rules and tests.
- [x] **T2 Settings and screens.** Their settings in the agent form, generic for the new agents.
- [x] **T3 Demo data.** The boot guard, `seed:demo`, the demo banner.
- [x] **T4 The live stream.** The worker job.
- [x] **T5 Docs, live check, completion status.**
