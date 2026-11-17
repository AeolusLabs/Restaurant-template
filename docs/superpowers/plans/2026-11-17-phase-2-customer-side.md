# Phase 2: Customer side. Implementation plan

> Executed inline, test first, one commit per task, on branch `phase-2-customer-side` (cut from `phase-1-foundation`). Progress is the checkbox list below plus `git log`.

**Goal:** A signed-in customer can browse the menu, build a cart, check out for pickup, pay through the payment provider, and watch the order's status. Everything runs on the mock payment provider locally; the Paystack adapter is written and contract-tested against a fake `fetch`, but never called live (no keys).

**Spec:** `docs/ARCHITECTURE.md` sections 5 to 9, 11 to 14 and 18 (Phase 2 row), plus `PRODUCT.md`.

## Global constraints

- Money is an integer in the minor unit. The browser sends item IDs, modifier IDs and quantities, never prices. The server prices from the database and `config`.
- A redirect back from the payment page is not proof of payment. Only a verified webhook, plus a provider `verify()` call, moves `placed` to `paid`. (Ruling 3 extends this to a server-side verify inside the expiry job.)
- All queries go through `withRequestContext` / `withSystemContext` / `withPublicContext`. Business logic imports provider types only.
- `domain/` stays pure. Sensitive fields: every response body built by us goes through a whitelist serializer in `src/lib/sanitize.ts`, and JSON route handlers are wrapped in `withScrub()`.
- Node runtime only. Cache Components is on, so anything reading cookies, headers or the database sits behind `<Suspense>`.
- Apply every migration to the dev database in the same task.
- WCAG 2.2 AA, 44px touch targets, status never by colour alone, fully responsive from 320px, no horizontal page scroll, reduced motion respected. Voice: short, concrete, no exclamation marks, no em dashes.

## Rulings (decided where the spec was silent or ambiguous)

1. **Tax and service charge order.** Service charge applies to the subtotal, tax applies to subtotal plus service charge. In inclusive mode the price already contains both: tax is extracted from the gross first, then the service charge from the remainder. `total = subtotal - discount + delivery (+ service + tax in exclusive mode)`.
2. **Pickup slots.** Slots are generated for today and the next 2 days from `openingHours`, every `slotMinutes`. A slot must start at least `minLeadMinutes` from now, and no later than `close - lastOrderCutoffMinutes`. The server re-validates the chosen slot; the client list is a convenience.
3. **Unpaid expiry never expires a paid order.** Before the expiry job cancels an order, it asks the provider whether the latest payment succeeded (`verify()`); if so it applies the payment instead. This closes the "money taken, order cancelled by a lost webhook" hole. It is a server-side verify, not a browser redirect.
4. **No pg-boss yet.** The worker is a small interval loop running idempotent job functions. pg-boss arrives when a job needs retries and backoff (Phase 4). The handlers do not change.
5. **Polling, not SSE.** The tracking page polls every 4 seconds (paused when the tab is hidden). The NOTIFY trigger and SSE arrive with the kitchen display in Phase 3.
6. **Payment webhook path** is `/api/webhooks/payment`, provider-agnostic, because business logic does not know the vendor. Docs and the Cloudflare skip rule use this path.
7. **Account deletion** needs `orders.profile_id` to be nullable with `ON DELETE SET NULL` (migration 0007), so removing the auth user can cascade through the profile and leave anonymised orders behind.
8. **System fonts, light theme.** No remote font fetch (faster, no build-time network). Light only: customers order from phones in mixed light, and a second theme doubles QA for no stated need.
9. **No menu images yet.** `image_key` stays unused until admin uploads exist (Phase 3), so the media proxy route is deferred.
10. **Email is not verified** at sign-up (there is no email provider). Better Auth's rate limits apply to sign-in.
11. **Legal pages** are plain-language template text driven by config, marked clearly as needing the restaurant's review before launch.

## Tasks

- [x] **T1 Foundations.** Migration `0007_phase2` (`orders.profile_id` nullable + `SET NULL`, `orders.checkout_token` with a unique index on `(profile_id, checkout_token)` so a double submit returns the same order, `GRANT UPDATE ON order_contacts TO system`), applied to dev. `withPublicContext()`. `transitionOrderIn(tx, input)` extracted from `transitionOrder`.
  - Tests: `tests/phase2-foundation.test.ts`: anonymous context reads active menu and nothing else; `transitionOrderIn` joins a caller's transaction and rolls back with it; deleting an auth user keeps its orders with `profile_id` null.
- [x] **T2 Pricing (pure).** `src/domain/pricing/price-cart.ts`: `priceCart(lines, menu, charges)` returns `{ lines, subtotalMinor, serviceChargeMinor, taxMinor, totalMinor }` or typed problems per line (`not_found`, `inactive`, `sold_out`, `modifier_invalid`, `selection_count`, `quantity`).
  - Tests: exclusive and inclusive modes, rounding at half, zero charges, modifiers add deltas, min/max select, unavailable item and modifier, quantity bounds, large quantities stay exact integers.
- [x] **T3 Pickup slots (pure).** `src/domain/pickup/slots.ts`: `pickupSlots(now, config)` and `isValidPickupSlot(at, now, config)`.
  - Tests: lead time, cutoff, closed day, break between two windows, midnight in the restaurant's timezone, a non-Lagos zone with DST, slot grid alignment.
- [x] **T4 Cart schema and order code (pure).** `src/domain/checkout/cart.ts` (`cartSchema`, `lineKey`), `src/domain/orders/public-code.ts` (`generatePublicCode()`, no `0 O 1 I`).
  - Tests: rejects negative, fractional and huge quantities, more than 50 lines, non-UUIDs; strips unknown keys such as `price`; code alphabet and length.
- [x] **T5 Menu read model.** `src/db/menu.ts`: `loadMenu()`, `loadMenuItem(slug)` (public context, active and sold-out flags, modifier groups).
  - Tests against the seed: categories ordered, inactive hidden, sold-out flagged.
- [x] **T6 Create order.** `src/db/orders.ts`: `createPickupOrder(ctx, input)` and `getOrderForCustomer`, `listOrdersForCustomer`. `toPublicOrder()` in `src/lib/sanitize.ts`.
  - Tests: prices from the database even when the client sends a price; snapshots survive a later menu edit; contact row written; kitchen cannot read contacts; another customer cannot read the order; closed or invalid slot refused; pickup feature off refuses; unavailable item refused.
- [x] **T7 Payments.** `src/payments/start-payment.ts`, `src/payments/apply-payment.ts`, `src/payments/webhook.ts`, `src/jobs/expire-unpaid.ts`.
  - Tests: attempt creates a unique reference and a retry creates a new one; replayed event changes nothing; concurrent duplicate delivery processes once; bad signature returns 401 and stores nothing; valid signature with mismatched amount does not mark paid and writes an audit entry; verify says failed leaves the order placed; payment after cancellation is recorded and flagged, not applied; expiry cancels only overdue unpaid orders and applies a payment the provider says succeeded.
- [x] **T8 Paystack adapter.** `src/providers/payment/paystack.ts`, registered in `src/providers/index.ts`.
  - Tests with a fake `fetch`: initialize request shape and kobo amounts, verify status mapping, HMAC-SHA512 signature check (constant time, bad and missing header), event ids, refund call, provider errors become `PaymentProviderError`, secrets never appear in thrown messages.
- [x] **T9 Worker.** `src/jobs/worker.ts`, `scripts/worker.mts`, `pnpm worker`. Runs expiry every minute; stops cleanly on SIGINT.
  - Tests: one tick runs the job; a failing job does not stop the loop.
- [x] **T10 Customer accounts (server side).** `nextCookies()` plugin, `src/auth/customer.ts` (`getCustomer()` for server components), server actions `signUpAction`, `signInAction`, `signOutAction`, `src/account/export.ts`, `src/account/delete.ts`, consent withdrawal.
  - Tests: export contains only the caller's rows and no hashes; deletion refused while an order is active; deletion anonymises orders and removes the auth user; a `data_requests` row is written; marketing consent can be withdrawn but terms cannot.
- [x] **T11 UI foundation.** Root layout, config-driven tokens, header with cart count, footer, skip link, legal pages, error and not-found pages.
- [x] **T12 Menu and cart UI.** Menu page, item page, client cart store, cart page with server quote.
- [x] **T13 Checkout, payment return and tracking.** Checkout page and place-order action, `/mock-pay/[reference]`, `/orders`, `/orders/[code]`, `GET /api/orders/[code]`, `POST /api/webhooks/payment`.
- [x] **T14 Account UI.** Sign-in, sign-up with unticked marketing consent, account page, data export and deletion screens, `GET /api/me/export`.
- [x] **T15 Turnstile.** `src/lib/turnstile.ts` (`verifyTurnstile`), widget shown only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set, wired into sign-up, sign-in and checkout actions.
  - Tests with a fake `fetch`: success, failure, network error fails closed when a secret is set, skipped (and logged once) when unset.
- [x] **T16 Docs and verification.** Update `docs/ARCHITECTURE.md` (section 21), `docs/runbook.md`, `CLAUDE.md` commands, build log. Full gate (`typecheck`, `lint`, `test`, `build`), live HTTP run of the whole purchase flow on the mock provider, screenshots at 375px and 1280px, accessibility pass, self-review.

## Review focus (inputs the tests above must not miss)

- A client that sends `price`, `priceMinor`, `total` or `status` fields in the cart or form is ignored, never trusted.
- A customer id in a URL or form is never used for authorisation; the session decides.
- A webhook for an unknown reference returns 200 and changes nothing (Paystack retries on non-2xx).
- A double click on "Pay" creates one order, not two (the action is idempotent per cart submission token).
- The cart holds an item that was deleted or sold out since it was added: the cart page says so and checkout is blocked, nothing crashes.
