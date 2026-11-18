# Phase 4 build log

Chowdeck delivery: delivery orders, rider booking with retries, following the delivery to the door, failure recovery, and a low-wallet alert. Plan: `docs/superpowers/plans/2026-11-18-phase-4-delivery.md`. Built inline on branch `phase-4-delivery` (cut from `phase-3-admin-core`), test first, one commit per task. Final state: 58 test files, 635 tests passing, typecheck, lint and production build clean. Migrations 0014 to 0017 are applied to the dev database.

## What exists

- **Delivery orders.** Checkout offers pickup or delivery (whichever is on and available). Delivery needs a zone from `config.delivery.zones`, an address and an optional landmark. The fee comes from the zone, is added after tax, is never taxed and is never sent by the browser. The live total on the form is priced by the server for the chosen zone.
- **Booking.** The worker queues a delivery when an order reaches `delivery.dispatchOn` and books it with a fresh quote. Five attempts with 1, 2, 4 and 8 minute backoff, then `delivery_failed`, an alert, and the admin Retry and Cancel actions. A booking that reached Chowdeck but was not recorded is adopted, not repeated.
- **Following the delivery.** Polling every 30 seconds is the primary source; a signed webhook at `/api/webhooks/delivery` is a faster path. Pickup moves the order to `out_for_delivery` (once it is `ready`), delivery completes it. Replays and old messages change nothing.
- **Recovery.** Retry (managers and owners) starts a new round and books again. Cancelling a delivery order also cancels the rider; if that fails the order is still cancelled and refunded and an alert says to stop the rider by hand.
- **Wallet.** Balance recorded every 5 minutes, one alert below `delivery.lowWalletMinor`, closed automatically on recovery, shown on the admin home.
- **Screens.** Customer order page (delivery steps, address, rider progress, follow-the-rider link), admin order page (booking, fee against cost, last problem, Retry), kitchen tickets say Delivery, admin home wallet and alert wording.
- **Chowdeck adapter** from the documented contract, 40 contract tests against a fake `fetch`.

## Rulings

The plan's seven rulings stand. Added while building:

- **A `round` on each delivery.** A manager's retry must not reuse an old booking reference (Chowdeck rejects duplicates, and adoption would then hand back the old, failed booking). References are `<code>-<round>-<attempt>` (migration 0017).
- **One delivery per provider reference** (unique index, migration 0016), so a webhook can never match two deliveries.
- **The wallet alert auto-closes on a healthy balance** at the next check. A booking that fails for a fee larger than a still-"healthy" balance will not keep it open; the threshold should be set above one delivery fee.
- **An unreadable wallet changes nothing.** Not knowing the balance is not the same as it being low.
- **No webhook secret means every webhook is refused.** Polling alone is enough.
- **The provider is resolved only when a rider exists,** so cancelling a pickup order or an unbooked delivery never touches the provider.
- **The worker runs every job once at start,** found in the live run: the wallet panel said "not checked yet" for five minutes after a restart.
- **Rider-cancel failures have their own alert wording** (`payload.action = cancel_rider`), found in the live run: the generic text told a manager to retry an order that was already refunded.

## Verified live (mock providers, real database, real worker)

Checkout with delivery (zone fee, total ₦3,800 to ₦5,300), mock payment, order page with delivery steps, accepting the order, the worker queuing and booking within 15 seconds, admin booking panel, wallet check, and cancel and refund with the rider-cancel alert. The mock riders are in memory per process, so the web server could not cancel a rider the worker had booked: that exercised the alert path, but it also means the live run never saw a rider move through assigned, picked up and delivered. That is covered only by tests (`tests/delivery-sync.test.ts`).

## Not verified

- **Everything about the real Chowdeck API.** No key, no sandbox, a base URL the docs give two answers for. Unknowns: the base URL, the webhook secret and whether Relay fires webhooks, the empty-wallet error wording, `item_type` and `country_code` values, and whether our `reference` is the one Chowdeck returns. The checklist is `docs/runbook.md` section 10.
- **Phone numbers** are sent as typed (for example `+234 803 111 2222`) with `country_code: "+234"`. Chowdeck may want a local number without the prefix, or no spaces. Untested.
- **Phone-width layout** of the new delivery form and the admin delivery panel was not looked at on a real phone viewport. They reuse the existing mobile-first classes.
- **A rider's progress live.** See above.
- Paystack, Railway, Cloudflare, Docker and PgBouncer are still unverified (earlier logs).
- Test discipline: the `staffDeliveryLabel` test and its implementation were written in one step, so I did not watch that one test fail first. The rest of Phase 4 was test first.

## Known gaps

- No "check the wallet now" button; the check is on a 5 minute timer.
- `wallet_snapshots` grows by one row per check (about 288 a day) and is never pruned.
- No redelivery through Chowdeck's redelivery endpoints: a retry books a new rider.
- The customer sees the rider's progress and tracking link, but not the rider's name or phone.
- The kitchen sees no delivery status (RLS gives deliveries to managers and owners only), only that the ticket is a delivery.
- Delivery times are "as soon as ready": no scheduled delivery and no estimate shown.
- Promos are Phase 5; QR codes 6; the dashboard 7.
