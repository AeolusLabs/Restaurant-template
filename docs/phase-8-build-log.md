# Phase 8 build log

The agent framework, a win-back agent, and a WhatsApp support agent. Plan: `docs/superpowers/plans/2026-11-18-phase-8-agents.md`. Built inline on branch `phase-8-agents` (cut from `phase-7-dashboard`), mostly test first, one commit per task. Final state: 82 test files, 994 tests passing, typecheck, lint and production build clean. Migrations 0025 to 0027 are applied to the dev database. Scope chosen by you: the WhatsApp agent is support only, and the win-back message is written for you, with an optional promo code a manager chooses.

## What exists

- **The framework.** An agent reads and returns proposals; it cannot send or change anything. The framework stores each proposal in the mode the agent's autonomy calls for, and only an executor, run after the decision, does the thing. Three levels: **Suggest only** (advice that can only be dismissed), **Ask me first** (a manager approves or rejects; approving carries it out), **Automatic**. Anything a customer will read runs automatically only after an owner has separately confirmed it by typing SEND, and moving the agent off Automatic takes the confirmation back.
- **Spend cap.** The model is reached only through a wrapper that reserves a call's worst-case cost against the agent's month (under a lock, so two runs cannot both spend the last of the budget), then replaces it with the real cost, and gives it back if the call fails. A cap of zero, the default, means nothing is ever sent to a model. A model with no price in config cannot be used.
- **Records.** Every run (what triggered it, its cost, why it stopped), every proposal, every decision and every execution is stored, and audited.
- **Win-back agent.** Once a day (or "Run now" by an owner) it proposes a WhatsApp message to customers who have an active marketing consent, a phone number, at least one paid order and a last paid order at least 45 days ago, are not blocked, and were not proposed in the last 90 days. It works at no AI cost: the model writes one message template per run, and if the cap or the model refuses, a fixed wording is used and the proposal says so. A promo code a manager chose is mentioned; if it is switched off, the run fails with a clear reason. Consent and blocking are checked again at the moment of sending.
- **WhatsApp support agent.** An inbound message arrives at `/api/webhooks/whatsapp` (signature-checked, replay-safe, ten answers an hour per number). The agent answers only from facts the restaurant's data supplies (menu, hours, delivery areas, and the sender's own latest order when their number matches exactly one customer). The customer's words reach the model only as the message, never inside the instructions, and the reply must fit a schema, be short, and contain no link, or the question goes to a manager as an alert instead.
- **Screens.** `/admin/agents` (state, spend against the cap, waiting suggestions), `/admin/agents/[key]` (owner settings, the SEND confirmation, run now, recent runs), `/admin/agents/proposals` (the queue: approve, reject or dismiss; recently dealt with, including any failure and its reason), and a suggestions card on the admin home.
- **A model adapter** (`src/providers/llm/anthropic.ts`) for the Anthropic Messages API, contract-tested against a fake `fetch`. It asks for one JSON object, checks it against the caller's schema, and treats a reply with no token counts as an error, because the cost could not be counted.

## Rulings

The plan's eleven rulings stand. Added while building:

- **A twelfth status, `failed`,** for a proposal that was approved but whose executor raised an error (the spec lists five). The error is kept and shown.
- **Advice can never be approved, even later.** The database policy only allows approving a proposal made to wait for approval, so changing an agent's level afterwards does not make old advice approvable.
- **Duplicate prevention is per open proposal,** not forever: a unique index stops a second *open* proposal with the same key, and the win-back cooldown (90 days) is enforced by the agent's own query.
- **Proposals carry the run's clock.** `created_at` is the run's `now`, so cooldowns behave the same in tests as in life.
- **An escalation raises a new alert kind, `support_question`,** shown on the admin home.
- **No model price, no call.** `agents.modelPrices` is empty by default and `ANTHROPIC_MODEL` has no default, so enabling a real model is a deliberate act.
- **The system role's table privileges came in a follow-up migration (0027),** because the first RLS migration omitted them; found by a test.

## Found by the tests

- The first migration gave the system role policies but no table privileges.
- A phone-number match written in SQL inside a JavaScript template lost its `\D` escape, so numbers with spaces did not match. Fixed with an explicit digit class.
- Tests running in parallel shared agents' saved settings and a global expiry sweep, which made them interfere. Each agent test now runs its own copy of the agent under a unique key, which needed the agent to know its own key.
- The payment webhook test counted every row in `webhook_events`, so it raced any new test that writes to it. It now counts only its own provider's rows.

## Verified live (real database, mock providers)

An owner switched the win-back agent on, chose Ask me first and a spending limit of zero, and saved. Run now proposed exactly one message to the marked, lapsed customer, in standard wording, flagged "A customer will read this", with nothing sent. Approve and send carried it out (cost ₦0.00). A signed inbound WhatsApp message was accepted; the same message again was a duplicate; a forged one was refused with 401. With no model priced, the support agent routed the question to a person as advice instead of guessing. The data from the check was removed.

## Not verified

- **A real language model.** The Anthropic adapter was never run against the live API (no key). Its request and response shapes are from the documentation as I know it, and must be checked with a real key. So the wording of messages from a real model, its cost per message, and how well it follows the support rules are all unmeasured.
- **A real WhatsApp provider.** There is none. The stub reads a signed test format. A real one will need its own adapter (and, for business-initiated messages, approved message templates), which is a known open task.
- **Any message actually reaching a phone.** Sending goes to the stub, which records it.
- **Prompt injection in the real world.** The design limits what an injected instruction could do (the model has no tools, sees only the facts, and its reply is checked), and tests cover the plumbing, but nobody has attacked it with a real model.
- **The screens at phone width,** and the SEND confirmation screen in a browser (the data layer is tested).
- Test discipline: the framework, the win-back agent, the scheduler and the settings form were written before or in the same step as their tests, not strictly after a failing test. The support agent, the webhook, the settings form, the admin layer and the adapter were test first.
- Everything still unverified from earlier phases (Chowdeck, Paystack, Railway, Cloudflare, PgBouncer, Docker).

## Known gaps

- Customers cannot say "stop" to the win-back messages by replying; withdrawing marketing consent is done in their account. A real provider's opt-out handling needs adding.
- No per-agent test mode that shows a proposal's cost before it is made, and no per-day cap (only monthly).
- Approving in the queue is one button; there is no "edit the message first".
- If an executor sends a message and the server then dies before it records the result, the proposal could be sent twice on retry. The window is small (one transaction) but real; a real provider's idempotency key would close it.
- The other agents named in the architecture (demand and prep planner, menu engineer, delivery watchdog, anomaly and abuse detector) are Phase 9.
