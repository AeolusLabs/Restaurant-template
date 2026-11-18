# Phase 3: Admin core. Implementation plan

> Executed inline, test first, one commit per task, on branch `phase-3-admin-core` (cut from `phase-2-customer-side`). Progress is the checkbox list plus `git log`.

**Goal:** Staff can sign in and run the restaurant: manage staff accounts, the menu (with photos), and orders (accept, prepare, hand over, cancel, refund), and the kitchen works from a live display. Everything works on a phone.

**Spec:** `docs/ARCHITECTURE.md` sections 5, 7, 11, 12 and 18 (Phase 3 row), `PRODUCT.md`. Roles and RLS already exist from Phase 1; this phase builds the screens and server code on them.

## Global constraints

- RBAC stays in Postgres RLS. Every staff query runs through `withRequestContext` as the signed-in staff member. UI hiding is a convenience, never the control. Each staff screen gates on `requireStaff(roles)`.
- Status changes only through `transitionOrder()`. The screens offer only the actions the matrix allows for that role and fulfilment (derived from `TRANSITIONS`, not copied).
- Money is integer minor units. Staff type prices in whole currency ("3500.50"), parsed exactly, never through floats.
- Staff actions that change data write `audit_log`. Kitchen never sees phone numbers or addresses (RLS on `order_contacts`).
- Node runtime only; Cache Components rules as in Phase 2 (session reads behind `<Suspense>`).
- WCAG 2.2 AA, fully responsive including the admin, kitchen display readable from across a room, status never by colour alone, destructive actions need a second deliberate step.

## Rulings

1. **Route groups.** Customer screens move into `src/app/(customer)/` with their own header and footer. `(admin)/admin` and `(kitchen)/kitchen` get their own shells. The root layout keeps only fonts, tokens and the skip link.
2. **Where staff land.** Signing in with no `next` sends owner and manager to `/admin` and kitchen to `/kitchen`. A customer-only page opened by staff still redirects to the menu.
3. **`alerts` table now.** Payments that cannot be applied (mismatch, late, duplicate) become alert rows managers can see and resolve, because `audit_log` is owner-only. The table is the Phase 4 `alerts` table (delivery failures and low wallet reuse it).
4. **Refunds are full refunds.** A staff refund returns the whole payment. The order moves to `refunded` as soon as the provider accepts the refund request; the refund row stays `pending` until the provider's `refund.processed` webhook marks it succeeded. Partial refunds wait for a need.
5. **Cancelling a paid order** (staff, or the customer before acceptance) cancels first, then refunds. If the provider refuses the refund the order stays cancelled with an alert, and a manager can retry the refund. A customer cancelling before acceptance is refunded by the system role. `orders.cancellationWindow = before_preparing` is not honoured for customers: the matrix lets customers cancel only a `paid` order, and changing the matrix is not part of this phase.
6. **Menu deletion is archiving.** Items and categories are switched off (`active = false`), never deleted, so past orders and links keep working. Modifier groups and modifiers can be deleted. A category cannot be archived into a state that hides an item silently: the screen says how many items it hides.
7. **Images.** Upload JPEG, PNG or WebP up to 2 MB, checked by content (magic bytes), not file name, stored through `StorageProvider` under a random key, served by `/api/media/[...key]`. The memory provider loses images on restart; the real S3 adapter comes with deployment.
8. **Realtime for staff only.** A trigger on `order_events` sends `pg_notify('order_events', ...)`; one listener per web process fans events out over Server-Sent Events to signed-in staff, with a 25 second heartbeat. The client also polls every 10 seconds, so a missed event heals itself. The customer tracking page stays on polling.
9. **No sound on the kitchen display** in this phase (browsers block audio without a tap, which breaks the "nothing needs a tap" rule). New orders are shown by a labelled "New" marker and a count in the page title.
10. **Staff creation by an owner sets a temporary password** (existing `createStaffUser`). Staff reset it through the Phase 2 reset flow once email is real.

## Tasks

- [x] **T1 Route groups and shells.** Move customer pages under `(customer)`; add `requireStaff()`; admin and kitchen layouts (responsive nav); role-based landing after sign-in.
  - Tests: `requireStaff` allows only the listed roles; the post-sign-in landing path per role; existing suite still green.
- [x] **T2 Money input.** `parseMoneyInput(text, exponent)` and `moneyInputValue(minor, exponent)` in `src/lib/money.ts`.
  - Tests: "3500", "3500.5", "3,500.50", "0.01"; refuses "3500.555", "-1", "abc", "1e3", over 2^53; round trip with `moneyInputValue`.
- [x] **T3 Staff order read model.** `src/db/staff-orders.ts`: `listOrdersForStaff`, `getOrderForStaff` with items, events, payments, refunds, and the phone only when RLS allows. Pure `nextActions(role, status, fulfilment)` in `src/domain/orders/actions.ts` from `TRANSITIONS`.
  - Tests: kitchen sees active orders and no contact; manager sees all with phone; `nextActions` per role and status, including that it never offers what `canTransition` refuses.
- [x] **T4 Order actions with audit.** `staffTransitionOrder(ctx, code, to, reason?)` writes an audit entry for manager and owner actions; typed errors.
  - Tests: kitchen can accept, prepare, ready, hand over; kitchen cannot cancel; manager can cancel; every management action is audited; a stale screen (status already changed) gives a clear error.
- [x] **T5 Alerts.** Migration `alerts` (RLS: system inserts, manager and owner read and resolve). `settlePayment` raises an alert for mismatch, late and duplicate payments. `listOpenAlerts`, `resolveAlert`.
  - Tests: each unapplied-payment case creates one alert; managers read and resolve, kitchen and customers see none; resolving is audited.
- [x] **T6 Refunds.** `refundOrder(ctx or system, code, deps)`; refund webhook handling; cancel-and-refund for staff; customer cancel of a paid order before acceptance.
  - Tests: full refund moves order to `refunded`, writes a refund row and marks the payment; refused for orders not cancelled or completed; only once; provider failure leaves order cancelled with an alert and a retry works; `refund.processed` webhook marks the refund succeeded once (replay safe); customer cancel before acceptance refunds, after acceptance is refused.
- [x] **T7 Staff management.** `src/auth/staff.ts` additions: `listStaff`, `changeStaffRole`, `blockStaff`/`unblockStaff` (owner), with audit.
  - Tests: owner lists, creates, changes roles, blocks; manager can list but not change; nobody changes their own role or blocks themselves; a blocked staff member's session stops working.
- [x] **T8 Menu management server code.** `src/db/menu-admin.ts`: categories, items, modifier groups, modifiers (create, update, archive or delete, reorder), with Zod, audit, and the "an item needs at least one price" style checks.
  - Tests: manager and owner can; kitchen and customer cannot (RLS); price stored exactly; sold-out toggle; archived items vanish from the customer menu; a modifier group's bounds are validated (`max >= min`, `min <= modifiers`).
- [x] **T9 Images.** `src/lib/image-upload.ts` (magic-byte check, size cap, random key), `/api/media/[...key]`, upload in item save.
  - Tests: accepts real JPEG, PNG and WebP bytes; refuses a renamed text file, an oversize file, a wrong type; the route serves what was stored with the right type and long caching, and 404s for unknown keys and path tricks.
- [x] **T10 Realtime.** Migration for the `order_events` NOTIFY trigger; `src/realtime/` listener, fan-out, SSE route `/api/stream/orders`, heartbeat.
  - Tests: inserting an order event delivers a notification; the fan-out reaches only signed-in staff streams and drops closed ones; the route refuses customers (403) and anonymous (401); heartbeat.
- [x] **T11 Kitchen display.** `/kitchen`: lanes (New, Cooking, Ready), large type, big buttons, live updates with polling fallback, page-title count, no contact details.
- [x] **T12 Admin orders screens.** `/admin/orders` (filters, search by code) and `/admin/orders/[code]` (detail, allowed actions, cancel with refund, refund, alerts).
- [x] **T13 Admin menu, staff and home screens.** `/admin` (needs attention: alerts, orders waiting to be accepted), `/admin/menu` (+ item and group editors, photo upload, sold-out toggles), `/admin/staff`.
- [x] **T14 Docs and verification.** Architecture section 22, runbook, build log; full gate; live walkthrough as owner, manager and kitchen; phone-width checks; self-review.

## Review focus

- A kitchen or customer session calling an admin route or server action directly is refused by the server, not just hidden.
- Two staff pressing "Accept" on the same order at once: one succeeds, the other is told it was already accepted.
- A refund requested twice (double click, two managers) refunds once.
- A price typed with a comma, a space or too many decimals is refused with a clear message, never silently rounded.
- Uploading a script or HTML file renamed to `.jpg` is refused.
