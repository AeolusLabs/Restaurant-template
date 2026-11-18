# Code review of Phases 3 to 9: findings and fixes

A `/code-review` (high) of everything from Phase 3 to Phase 9 returned ten findings. Each was fixed test first on branch `review-fixes`, one commit each, and the red-then-green was watched (the new tests failed without the fix). Final state: 87 test files, 1086 tests, typecheck, lint and production build clean. No migration.

| # | Finding | Fix |
| --- | --- | --- |
| 1 | The stub WhatsApp provider verified inbound messages with a secret written in the source, so anyone could forge one. | The secret is `STUB_INBOUND_SECRET`. With none set the stub accepts no inbound message at all (including one signed with the old value). A real adapter replaces the stub. |
| 2 | A refund the provider paid out could be left with the order not `refunded`, and pressing Refund again said "already refunded". | Pressing Refund again finishes the order step without asking the provider a second time. A failure at that step says so plainly (`order_not_updated`). |
| 3 | A WhatsApp message whose agent run failed was marked processed, so the provider never retried. | A failed run fails the webhook; the event is flagged failed and the retry claims it once. A switched-off agent or a reached spend cap stays "processed" (a decision, not a failure). |
| 4 | "Run now" could carry out automatic proposals, though it is worded as propose-only. | A manual run never carries anything out: automatic proposals wait for approval, as the screen says. |
| 5 | An expired proposal could still be approved or carried out until the expiry job ran. | Approving is refused once past `expires_at`; carrying out closes it as expired. |
| 6 | Executors sent while holding the proposal's lock inside the transaction that marks it executed, so a later failure could cause a second send. | The proposal is marked executed (and the lock released) before the executor runs. A failure then marks it failed; a crash in between leaves it executed rather than risking a duplicate message. |
| 7 | The anomaly detector's customer block could run automatically. | `ProposalDraft.neverAuto`: such a proposal always waits for a person, whatever the autonomy or confirmation. |
| 8 | Every scan GET inserted a row, including prefetches, link previews and crawlers; the slug was read in two queries. | One query; prefetch, preview and crawler visits still redirect but are not counted. |
| 9 | A cancelled order whose refund failed still counted as sales. | Sales exclude cancelled orders. |
| 10 | A failed `LISTEN` left a database connection open on every retry. | The attempt's connection is closed before the retry. |

## Found while fixing

- **The WhatsApp webhook's old failure path never worked.** It deleted the stored event so a retry would be processed, but the system role has no DELETE on `webhook_events` (deliberately: they are a record), so the delete itself threw and hid the real error. Finding 3's test exposed it. The event is now flagged and the retry claims it.

## Rulings and limits

- **Running an agent by hand changes what "auto" means for that one run.** Proposals made by a manual run are stored as "approve" even when the agent is on automatic, so they appear in the queue. The scheduled run still carries them out.
- **At-most-once sending (6).** If the process dies after a proposal is marked executed but before the executor finishes, the proposal shows "executed" with no result and the message may not have been sent. This was chosen over the opposite risk of messaging a customer twice. The audit trail shows the run.
- **A crash between the provider's refund call and the database update (2) is not repaired.** The refund row stays reserved with no provider reference; a retry reports "already being refunded". Resolving it needs a lookup of the refund at the provider, which is not built.
- **Partial refunds (9).** The status `partially_refunded` exists but nothing writes it, so the dashboard's refund figures were not changed for it.
- **Bot detection (8) is by header and user-agent only**, so it will miss a crawler that disguises itself and may skip a rare real visitor whose browser sends a prefetch header. Scans are still unthrottled by visitor (nothing about visitors is stored).
- **Not tested directly:** the new `order_not_updated` error path in refunds (only the recovery state is tested); the demo-mode boot guard does not yet insist on `STUB_INBOUND_SECRET` (unset is the safe default).
