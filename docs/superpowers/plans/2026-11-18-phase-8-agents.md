# Phase 8: Agent framework, win-back agent, WhatsApp support agent. Implementation plan

> Executed inline, test first, one commit per task, on branch `phase-8-agents` (cut from `phase-7-dashboard`).

**Goal:** A framework in which an agent can only *propose*, and a person (or an explicitly confirmed automatic setting) decides what happens. On it: a **win-back agent** that proposes a friendly message to customers who agreed to marketing and have gone quiet, and a **WhatsApp support agent** that proposes answers to customers' questions from the restaurant's own data. Spending on a language model is capped per agent per month, and every run, proposal and decision leaves a record.

**Spec:** `docs/ARCHITECTURE.md` section 15 (agent framework) and 9 (provider interfaces); `CLAUDE.md` rules 3, 7, 9, 10. **Scope chosen by you:** the WhatsApp agent is support only (it never places or changes an order); the win-back message is written for you, with an optional promo code that a manager chooses in settings, and the agent never creates promos.

## Global constraints

- An agent never performs side effects. It reads, and returns proposals. Only an executor, run by the framework, sends or changes anything.
- The language model is reached only through the framework's budgeted wrapper. Before each call it counts this month's cost for that agent plus an estimate of the call, and refuses if the cap would be passed. A cap of 0 (the default) means nothing can be spent.
- Customer-facing proposals (anything a customer will read) are never sent automatically unless that agent is set to `auto` **and** an owner has separately confirmed it. Otherwise they wait for approval, or are only advice.
- Marketing messages go only to customers with an active marketing consent, checked again at the moment of sending. A blocked or deleted customer is never messaged.
- RLS: managers and owners read agent data; owners change agent settings; managers and owners decide proposals; only the system runs and executes. Customers and the kitchen see nothing.
- Every migration is applied to the dev database in the same task. `features.ai_agents` off means no agent screens, no jobs and no webhook.

## Rulings

1. **Three levels.** `suggest_only` (default): proposals are advice and can only be dismissed. `approve_first`: a manager approves or rejects, and approval runs the executor. `auto`: the executor runs at once. A proposal remembers the level it was made under; changing the level later does not change proposals already waiting.
2. **`auto` for customer-facing proposals needs an owner's separate confirmation** (typing a word, recorded with who and when). Without it, an `auto` agent treats customer-facing proposals as `approve_first`.
3. **An extra status, `failed`,** for a proposal that was approved but whose executor raised an error, with the error kept. (The spec lists five statuses; hiding a failure inside `approved` would lie.)
4. **Duplicates are prevented** by a dedupe key per agent (for example one win-back per customer per cooldown), enforced by the database.
5. **Cost is worked out in whole minor units** from the config price table (`agents.modelPrices`, per million tokens), rounded up, so spend is never under-counted. A model with no price in the table cannot be called.
6. **The month is the restaurant's calendar month** in its timezone.
7. **The win-back agent works with no AI spend.** It asks the model once per run for a message template with `{name}` and `{dish}` placeholders; if the cap refuses, or the model fails, it uses a fixed template, and says so on the proposal. Customers get a personalised message either way.
8. **Win-back selection:** customer role, not blocked, active marketing consent, a phone number, at least one paid order, last paid order at least `lapsedDays` ago (default 45), not proposed in the last `cooldownDays` (default 90), most recent first, at most `maxPerRun` (default 20).
9. **The WhatsApp agent answers only from facts we hand it** (menu, hours, delivery areas, and, when the sender's number matches an account, that customer's latest order). The customer's text is untrusted: the model's reply must fit a schema (a short reply, and whether a person should take over), and it has no tools. A question it cannot answer becomes an alert for a manager, not a guess.
10. **Inbound WhatsApp** arrives at \`/api/webhooks/whatsapp\`, signature-checked and idempotent like the other webhooks. There is no real WhatsApp adapter yet: the stub provider parses a signed test format.
11. **A real language-model adapter (Anthropic Messages API)** is written from the documentation and contract-tested against a fake `fetch`, never run live, like the Paystack and Chowdeck adapters.

## Tasks

- [ ] **T1 Pure rules.** Cost, the month window, which level applies, message templates and their checks.
- [ ] **T2 Tables.** `agent_configs`, `agent_runs`, `agent_proposals` with RLS (migrations, applied).
- [ ] **T3 The framework.** The `Agent` contract, the registry, the budgeted model wrapper, running an agent, storing proposals, deciding and executing, with audit.
- [ ] **T4 Win-back.** The agent, its executor, and the worker job.
- [ ] **T5 WhatsApp support.** Inbound webhook, the agent, its executor.
- [ ] **T6 Screens.** Agents, settings, the proposal queue, runs.
- [ ] **T7 The model adapter, docs, live check, completion status.**
