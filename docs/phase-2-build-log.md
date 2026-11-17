# Phase 2 build log

Customer side: menu, cart, accounts, pickup checkout, payment, order tracking. Plan: `docs/superpowers/plans/2026-11-17-phase-2-customer-side.md`. Built inline on branch `phase-2-customer-side` (cut from `phase-1-foundation`), test first, one commit per task. Final state: 36 test files, 370 tests passing, typecheck, lint and production build clean.

## Rulings

The plan's eleven rulings stand (tax order, slot rules, the expiry job verifying with the provider before it cancels, an interval loop instead of pg-boss, polling instead of SSE, `/api/webhooks/payment`, nullable `orders.profile_id`, system fonts and a light theme, no menu images, no email verification, template legal text). Added while building:

- **Double submit.** `orders.checkout_token` (unique per customer) makes a repeated submit return the same order. The token is minted per checkout page load.
- **Honest total.** The checkout form sends the total it showed (`expectedTotalMinor`). If the server's price differs, the order is refused instead of placed.
- **Brand colour guard.** `config.colors.primary` must be an `oklch()` value dark enough for white text (4.5:1). Any other syntax is refused at boot with a message saying how to fix it.
- **Provider cache on `globalThis`.** One provider instance is shared across route bundles and reloads, because the mock keeps payments in memory. Because a reload can leave an instance built from an older copy of a class, `WebhookSignatureError` is recognised by name as well as `instanceof`, and the fake payment page checks `provider.name`, not `instanceof`. This was found by running the app, not by the tests.
- **Forms keep what was typed.** React 19 clears a form after a server action. Actions now hand back the submitted values (never passwords) and the forms show them again.
- **Webhook payloads are redacted on account deletion** (they carry the customer's email), matched by payment reference.
- **Staff on the customer site.** A staff account that opens a customer-only page is sent to the menu. Staff screens come in Phase 3.

## Not verified

- **The Paystack adapter has never touched Paystack.** Its docs returned 403 to automated fetches, so the endpoints, field names and the `x-paystack-signature` scheme come from memory of the public API. Contract tests prove the adapter does what it was written to do, not that Paystack agrees. Test with a Paystack test key before any live use (`docs/runbook.md` section 8).
- **CSP `form-action 'self'`.** A server action that redirects to Paystack's page is a script navigation, which the policy does not touch. If JavaScript is off, the browser may block the redirect. If it does, add Paystack's checkout origin to `form-action` in `src/lib/perimeter.ts`.
- **Turnstile** is tested against a fake `fetch` only. The widget has never rendered against a real site key.
- **Screen readers, axe and Lighthouse were not run.** Layout was checked in a real browser at desktop width, and at 320px by constraining the page width and testing for overflow and touch-target sizes (the browser window would not resize, so media queries were not exercised at phone widths).
- Railway, Cloudflare, Docker and PgBouncer are still unverified (Phase 1 list).

## Known gaps and decisions for you

- **Password reset exists, but cannot deliver email yet.** The flow is built and tested (see below), and the email provider is a local fake that prints to the server log. Before launch an adapter for a real email service must be written and selected, or customers who forget their password are locked out.
- **Sign-up does not verify email**, so a typo'd address is accepted.
- **A paid order cannot be cancelled by the customer** from the site. Cancelling means refunding, which staff do in Phase 3. A payment that cannot be applied (wrong amount, a cancelled order, a second payment) is recorded and flagged in `audit_log`, with no screen to see or refund it until Phase 3.
- **`PAYMENT_PROVIDER=mock` exposes a public fake payment page** that marks orders paid. That is intended for showcase deploys (hard rule 11) and must not be used for a restaurant taking real orders.
- Order list shows the latest 50; the menu is read on every request (no caching); pickup slots cover today plus two days (`PICKUP_DAYS_AHEAD`).
- Order tracking polls every 4 seconds instead of streaming.

## Deferred minor findings

- Account deletion leaves `order_events.actor_id` values that no longer point to anyone. They carry no personal data.
- `legal-page.tsx` shows a "template wording" banner outside production only; nothing forces the restaurant to replace the text.

## State left on this machine

- The dev database (port 55432) has one test account (`ada.tester@example.com`) and one accepted order (`7VSHT7`) from the live walkthrough.
- The dev server I started for that walkthrough is still running on port 3000 (PID 36712). It holds code from before the last fixes. I was not permitted to stop it, so stop it yourself and run `pnpm dev` again.
- The Phase 1 incident on your other project's database is unchanged and still awaits your decision (`docs/phase-1-build-log.md`).

## Review

Self-review by the author, not a fresh reviewer. The live walkthrough found five real defects the tests had not: a cached provider breaking `instanceof` after a reload (twice), forms wiping what was typed, a validation message that never appeared, and a skip link under the 44px touch target. A fresh review (`/code-review`) is recommended before merging.

## Added after approval: password reset and clean-up

- **Password reset.** `EmailProvider` (interface, `MockEmailProvider`, `EMAIL_PROVIDER`), Better Auth's `sendResetPassword` wired to it, `/forgot-password` and `/reset-password`, a "Forgot your password?" link, and a confirmation on the sign-in page. Rulings: a reset request answers identically for known and unknown addresses (and a failed send is logged, not shown, for the same reason); the link works once and expires in 1 hour; a successful reset deletes every session on the account; the emails are plain text; Turnstile guards the request form. Tested against a real database: one email per request, none for unknown addresses, the new password works and the old does not, single use, expiry, a made-up token, a too-short password not spending the link, and sessions revoked.
- **Clean-up.** The empty cart is no longer sent for pricing, the delete-account tick survives a refusal, `_`-prefixed unused parameters no longer warn (lint now reports zero warnings), and the walkthrough's test account and order were removed from the dev database. The sample brand colour measures 5.18:1 against white, so that note was wrong and is gone.
- **Left alone on purpose:** your other project's database (Phase 1 incident). Changing a database I do not own needs your explicit go-ahead.
