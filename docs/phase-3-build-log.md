# Phase 3 build log

Admin core: staff accounts, menu management with photos, order management with refunds, and a live kitchen display. Plan: `docs/superpowers/plans/2026-11-18-phase-3-admin-core.md`. Built inline on branch `phase-3-admin-core` (cut from `phase-2-customer-side`), test first, one commit per task. Final state: 49 test files, 506 tests passing, typecheck, lint and production build clean. Migrations 0009 to 0013 are applied to the dev database.

## What exists

- **Shells and access.** Customer, admin and kitchen are separate route groups with their own headers. `requireStaff()` sends people to sign in, or to their own home, and never in a circle. Signing in with no destination lands owners and managers on `/admin` and kitchen on `/kitchen`. Row-level security is still the real control.
- **Orders.** `/admin/orders` (filters, search by code or name), `/admin/orders/[code]` (customer and phone, items, totals, payments, refunds, history, alerts, and the actions the state machine allows for that person). Cancelling a paid order refunds it; a completed or cancelled order can be refunded in full.
- **Kitchen.** `/kitchen` shows New, Cooking and Ready lanes in large type with one-tap actions, live over Server-Sent Events with a 10 second polling fallback. No phone numbers or payments reach the kitchen (RLS).
- **Menu.** `/admin/menu` and the item editor: categories, items, photos, choice groups and choices, sold-out switch, archive, reorder. Prices are typed in whole currency and parsed exactly.
- **Staff.** `/admin/staff`: owners add staff, change roles, block and unblock, and email a password reset. Managers can see the list.
- **Alerts.** Payments that cannot be applied, and failed refunds, appear on the admin home until someone marks them dealt with.
- **Customers** can cancel their own paid order until the restaurant accepts it, and are refunded automatically.

## Rulings

The plan's ten rulings stand. Added while building:

- **The system may refund.** A customer who cancels their own paid order is refunded without staff, so the matrix now lets `system` move `cancelled` to `refunded` (migration 0012). The TypeScript matrix and the seeded table still match (a test checks).
- **One live refund per payment** is enforced by a unique index (migration 0011), so two people pressing Refund together refund once. A refund the provider refused does not count, so it can be retried.
- **Staff cannot cancel an unpaid order.** The matrix leaves that to the customer and the expiry job, and I kept it.
- **Staff accounts are created directly,** not through the sign-up call. Found by running it: the sign-up call signs the new person in, and from a server action that put their session in the owner's browser. A test now fails if a session is created.
- **Staff forms keep what was typed** after a refusal by carrying the values in the address (never passwords), the same bug Phase 2 fixed for customer forms.
- **Realtime is per web process.** Each process runs one listener on `DATABASE_UNPOOLED_URL`; the listener reconnects by itself, and screens poll so a missed message heals.

## Not verified

- **Photo upload through a browser** was not exercised (the browser tool could not choose a file). The server side is tested with real JPEG, PNG and WebP bytes and with files that only pretend to be images. The 3 MB request limit for server actions is set in `next.config.ts` but was not exercised.
- **Phone-width layout** of the admin and kitchen screens was not exercised at a real phone viewport (the browser window would not resize). Layouts use the same mobile-first classes as the customer site, and a 320px overflow check found nothing, but a real phone should be tried.
- **Refunds against Paystack** have never run; the adapter's refund call is covered only by a fake `fetch` (Phase 2 caveat).
- **Server-Sent Events behind Cloudflare and Railway** were not tested. The 25 second heartbeat and the `no-transform` and `X-Accel-Buffering` headers are there for that, and the polling fallback means the kitchen still works if the stream is blocked.
- **Menu photos live in memory** until an S3 adapter exists, so they vanish when the server restarts. This must be solved before launch.
- Railway, Cloudflare, Docker and PgBouncer are still unverified (Phase 1 list). On Railway the web service needs `DATABASE_UNPOOLED_URL` set, or the kitchen's live updates cannot start.

## Known gaps

- Managers cannot read the audit log (owners only, by design), and there is no screen for it yet.
- The kitchen cannot mark an item sold out (RLS gives menu writes to managers and owners only).
- Customer management and promos are Phase 5; the dashboard is Phase 7.
- No sound on the kitchen display (see ruling 9).
- Customer order tracking still polls; only staff screens are live.
- A flaky Windows error when the test database shuts down (EBUSY) was fixed in Phase 2; one racy realtime test was fixed here. Both only affected the suite, not the app.

## Deferred minor findings

- Alert resolution has no undo.
- The order list shows the newest 100 and says so, with no paging.
- Reordering uses up and down buttons, not drag and drop.
- Staff names and emails are not editable from the screen.

## Review

Self-review by the author, not a fresh reviewer. Running the app found three real defects the tests had not: staff creation replacing the owner's session, forms wiping typed values (twice), and a racy test. A fresh review (`/code-review`) is recommended before merging.
