# Phase 4: Chowdeck delivery. Implementation plan

> Executed inline, test first, one commit per task, on branch `phase-4-delivery` (cut from `phase-3-admin-core`).

**Goal:** A customer can order delivery to an address in a configured zone. When the restaurant accepts the order, the system books a Chowdeck rider, follows the delivery to the door, and moves the order along. When booking or delivery fails, a paid order is never lost: it becomes `delivery_failed`, an alert is raised, and a manager can retry or cancel and refund. A low Chowdeck wallet raises an alert before bookings start failing.

**Spec:** `docs/ARCHITECTURE.md` sections 5, 7, 8, 10, 12; hard rule 12 in `CLAUDE.md`.

## What Chowdeck's own documentation says (read 2026-11-18 from chowdeck-api.readme.io)

Used as the adapter's contract. Everything marked "unknown" is handled defensively, not guessed.

- Auth: `Authorization: Bearer <key>`. No sandbox anywhere. Base URL conflicts (`api.chowdeck.com` in the API reference, `api.relay.chowdeck.com` in the guides): `CHOWDECK_BASE_URL` has no default.
- Quote: `POST /relay/delivery/fee` with `source_address_string` / `destination_address_string` (or coordinates) and `estimated_order_amount`. Response `data.id` (fee id, integer) and `data.total_amount` (kobo). No quote lifetime is documented.
- Create: `POST /relay/delivery` with `fee_id`, `item_type`, `user_action` ("sending"), `source_contact` and `destination_contact` (`name`, `phone`, `country_code`), optional `reference`, `estimated_order_amount`, `customer_delivery_note`. Response `data.reference`, `data.delivery_price`, `data.status`, `tracking_url` (guide only). Errors: "This delivery fee has expired", "Possible duplicate order. Please send unique reference". Insufficient wallet: not documented.
- Get: `GET /relay/delivery/{reference}`, `data.status`, `data.tracking_url`. Cancel: `POST /relay/delivery/{reference}/cancel` with `reason`. Wallet: `GET /relay/wallet/balance`, `data.balance` in kobo.
- Status words disagree between pages: `preparing`, `awaiting_pickup`, `in_transit`, `success`, `rejected` (guide) against `picked`, `arrived`, `completed`, `accepted` (webhook events). The adapter maps all of them; anything else is `unknown` and never counts as delivered.
- Webhooks: `x-chowdeck-signature`, HMAC-SHA256 hex of the raw body. Where the secret comes from, and whether Relay deliveries fire events at all, is not documented. Polling is therefore the primary status source.

## Global constraints

- Delivery fee charged to the customer comes from the configured zone, never from the browser. Any difference from Chowdeck's cost is absorbed and recorded (`fee_charged_minor` against `provider_cost_minor`).
- A paid delivery order must never be stranded: booking failures retry with backoff, then fail loudly (`delivery_failed` + alert + admin retry and cancel).
- Quotes are never reused: always a fresh quote at dispatch, re-quoted once if it has expired.
- Every provider response is validated; a status we do not know is `unknown`.
- All status changes go through `transitionOrder`; all new tables have RLS.

## Rulings

1. **A database queue, not pg-boss.** Bookings are rows in `deliveries` with `attempts` and `next_attempt_at`, handled by the existing worker loop. This gives retries, backoff and visibility without a new dependency, and every state is something an admin can see. (Phase 2 ruling 4 expected pg-boss here; the need turned out to be satisfied by the table.)
2. **Delivery addresses are typed text in a configured zone.** The customer picks a zone (`config.delivery.zones`, name and fee) and types an address and optional landmark. No geocoding: Chowdeck accepts address strings.
3. **Delivery orders are ASAP,** with no pickup slot, and can only be placed while the restaurant is open.
4. **The rider's pickup can come before the kitchen marks the order ready** (dispatch happens at `accepted`). The order moves to `out_for_delivery` only from `ready`; until then the provider status is stored and applied on a later tick.
5. **Max 5 booking attempts** with backoff of 1, 2, 4 and 8 minutes, then `delivery_failed`. An insufficient wallet raises a `wallet_low` alert at once and keeps retrying.
6. **Cancelling a dispatched delivery order cancels the rider too** (best effort; a failure raises an alert).
7. **Low wallet threshold** is `config.delivery.lowWalletMinor`. The wallet alert closes itself when the balance recovers.

## Tasks

- [ ] **T1 Config and pricing.** `delivery.lowWalletMinor`; `priceCart` takes a delivery fee (added after tax, never taxed).
- [ ] **T2 Delivery orders.** `createDeliveryOrder` (zone, address, open-hours check, fee from config, contact snapshot).
- [ ] **T3 Tables.** `deliveries` and `wallet_snapshots` with RLS (migrations); `raiseAlert` allows no order.
- [ ] **T4 Dispatch.** Queue deliveries for orders at `dispatchOn`, book with a fresh quote, retry with backoff, fail loudly.
- [ ] **T5 Status sync.** Apply provider status to the delivery row and the order (poll and webhook share one function).
- [ ] **T6 Resolution.** Retry a failed delivery; cancel (with rider cancel and refund).
- [ ] **T7 Wallet check.** Snapshot, low-balance alert, self-closing.
- [ ] **T8 Chowdeck adapter** from the documented contract, contract-tested against a fake `fetch`, plus the delivery webhook route.
- [ ] **T9 Screens.** Checkout delivery option, customer tracking steps and rider link, kitchen and admin delivery details and actions, alerts text, wallet on the admin home.
- [ ] **T10 Worker jobs, docs, verification, completion status.**

## Review focus

- A webhook or poll reporting `delivered` for an order that is not yet out for delivery.
- Two workers booking the same queued delivery (one booking, one rider).
- A quote that expires between quoting and creating.
- A cancelled order whose delivery was already queued or booked.
- A delivery address or note containing HTML or very long text.
