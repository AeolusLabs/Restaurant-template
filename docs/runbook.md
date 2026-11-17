# Runbook

Operating notes for deploying and running restaurant-template on Railway behind Cloudflare.
Anything marked **verify** comes from vendor docs or reasoning and has not been run against a live account.

## 1. Railway project layout

One Railway project per restaurant, with:
- `web` service: this repo, built from the `Dockerfile` (`runner` target) or Railpack. The only service with a public domain.
- PostgreSQL 18 service, with the connection pooler (PgBouncer, transaction mode) enabled for `web`.
- One storage bucket (private, S3-compatible).
- `worker` service: same repo, start command `pnpm worker`. It runs the unpaid-order expiry job every minute, so it must be running for abandoned orders to be cancelled. It needs the same `DATABASE_SYSTEM_URL`, `PAYMENT_PROVIDER` and provider keys as `web`.

The `web` service talks to Postgres over Railway's private network (`*.railway.internal`).

## 2. Database setup

Roles and database are created by a script, not by hand. Run it once against the new Postgres from your own machine, using Railway's public TCP proxy URL for the default superuser:

```
DATABASE_ADMIN_URL=postgres://postgres:<password>@<proxy-host>:<port>/postgres \
DATABASE_MIGRATOR_URL=postgres://migrator:<new password>@<proxy-host>:<port>/restaurant \
DATABASE_URL=postgres://app:<new password>@<proxy-host>:<port>/restaurant \
DATABASE_SYSTEM_URL=postgres://system:<new password>@<proxy-host>:<port>/restaurant \
pnpm setup
```

`db:bootstrap` refuses any server that is not real PostgreSQL 18, so a wrong target fails before it changes anything. After this, the running service uses the **private** URLs:

| Variable | Used by | Points at |
|---|---|---|
| `DATABASE_URL` | web, user requests (`app` role) | the pooled (PgBouncer) private URL |
| `DATABASE_UNPOOLED_URL` | LISTEN/NOTIFY and the job queue (later phases) | the direct private URL |
| `DATABASE_SYSTEM_URL` | web and worker, webhooks, jobs, Better Auth (`system` role) | the pooled private URL |
| `DATABASE_MIGRATOR_URL` | migrations only, never set on the running service | the direct URL |
| `DATABASE_ADMIN_URL` | `db:bootstrap` only, never set on the running service | the direct URL |

Run `pnpm db:migrate` from your machine (or CI) before each deploy that adds a migration. Migrations are additive-first; apply them in the same change that needs them.

## 3. Environment variables

`.env.example` lists every variable. Set the rest on the `web` service in Railway:
`BETTER_AUTH_SECRET` (32 or more random characters), `APP_URL` (the public https URL), `ORIGIN_LOCK_SECRET` (section 6), `TURNSTILE_SECRET_KEY`, and the provider selectors. With no provider keys set, every provider stays on its local fake, so the app never calls a real service by accident. `INITIAL_OWNER_EMAIL` and `INITIAL_OWNER_PASSWORD` create the first owner on `db:seed`; remove both after the first run.

## 4. Backups and point-in-time recovery

Railway documents daily, weekly and monthly volume backups (6 days, 27 days and 89 days retention) and a point-in-time recovery (PITR) option with roughly a four-week window. **Both are switched on by hand per service. Do it at provisioning, before real data exists.** Which Railway plans include them is not documented. **verify** before launch.

Restore rehearsal, once before launch and after any change to how data is stored:
1. Take a manual backup, then add a throwaway order row.
2. Restore the backup into a new service (Railway restores into a new volume or a sibling service, never over the live one).
3. Confirm the restored database opens, the migrations table is intact, and the throwaway row is absent.
4. Delete the restored service. Record the date and who ran it here.

## 5. Secret rotation

| Secret | Steps | Effect |
|---|---|---|
| `BETTER_AUTH_SECRET` | Set the new value, redeploy. | Every session is signed out. |
| Database role passwords | Put the new password in the three `DATABASE_*_URL` values, run `pnpm db:bootstrap` (it re-sets passwords), then update Railway variables and redeploy. | A short window where the old password stops working. |
| `ORIGIN_LOCK_SECRET` | Change the Cloudflare Transform Rule and the Railway variable together. | Requests fail with 403 if the two differ for a moment. Do it in a quiet minute. |
| Paystack, Chowdeck keys | Rotate in the vendor dashboard, update Railway variables. | Pending webhooks signed with the old secret are rejected. |

## 6. Cloudflare

- Buy the domain at Cloudflare Registrar (at cost), so its nameservers are Cloudflare's. A `.ng` domain may not be sold there: **verify**, otherwise register with a NiRA-accredited registrar and point the nameservers at Cloudflare.
- DNS: a proxied (orange-cloud) CNAME from the domain to the Railway `web` custom domain.
- SSL/TLS mode **Full (strict)**. **verify** the certificate setup for a Railway custom domain behind the proxy.
- **Origin lock.** A Transform Rule adds the request header `x-origin-lock: <ORIGIN_LOCK_SECRET>` to every proxied request. `src/proxy.ts` rejects requests without it with 403. Railway's own `*.up.railway.app` URL then cannot be used to skip the WAF. Disable that URL too if Railway allows.
- WAF: managed rules and bot protection on. Rate limits on login and checkout paths. A skip rule for `/api/webhooks/*` (the payment webhook is `/api/webhooks/payment`) so the providers are not challenged; their signature checks are the gate there. In the Paystack dashboard set the webhook URL to `https://<domain>/api/webhooks/payment`.
- Turnstile on sign-up, sign-in and checkout. Create a widget in the Cloudflare dashboard, then set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (a build-time variable, so set it before the build) and `TURNSTILE_SECRET_KEY`. With no secret the server skips the check and logs a warning, so a production deploy without it has no bot protection on those forms.
- Optional: Cloudflare Access in front of `/admin` and `/kitchen`. Check the free-tier seat limit.
- Streams (kitchen feed, later): send a comment line every 25 seconds so Cloudflare's idle timeout does not close the connection.

## 7. First deploy checks

1. `select version()` on the Railway database reports PostgreSQL 18, and note the image tag (the docs list 18 but give no tag).
2. **PgBouncer.** Run the request-context test shape against the pooled URL: two users alternating through the pool must never see each other's rows (`tests/rls-context.test.ts` does this against a pool of one connection). Transaction mode is expected to be safe because the identity is set with `set_config(..., true)`. This has never been run through a real pooler. **verify**
3. Confirm backups and PITR are on, and run section 4.
4. Sign up through the site, confirm the profile and consent rows exist, then sign in with the first owner.
5. Check that a request straight to the Railway URL (no Cloudflare) returns 403.

## 8. Phase 2 checks before taking real orders

1. **Mock provider.** `PAYMENT_PROVIDER=mock` serves a public fake payment page at `/mock-pay/<reference>` that marks an order paid with no real money. That is right for a showcase deploy and wrong for a restaurant taking orders. Confirm the variable says `paystack` in production.
2. **Paystack, with a test key first.** The adapter has only been tested against a fake `fetch`. With `PAYSTACK_SECRET_KEY` set to a test key: place an order, pay with Paystack's test card, and confirm the webhook arrives at `/api/webhooks/payment`, the order becomes paid, and a replayed event changes nothing. **verify**
3. **Worker.** Place an order, do not pay, and confirm it is cancelled after `orders.unpaidExpiryMinutes` (watch the worker log for `expire-unpaid`).
4. **Legal pages.** `/legal/terms` and `/legal/privacy` hold template wording. Replace it with the restaurant's reviewed text and bump `legal.policyVersion` in `config/restaurant.ts`.
5. **Email and password reset.** `EMAIL_PROVIDER=mock` sends nothing, so "Forgot your password?" appears to work but no email arrives. Write an email adapter (docs/modules.md) and set `EMAIL_PROVIDER` before launch, then request a reset for a test account and confirm the email arrives, the link opens `/reset-password`, and the old password stops working. Reset links work once and expire after 1 hour; a reset signs the account out everywhere. Without email, the owner can reset a customer's password in the database only through the same flow, so there is no workaround.
6. **Refunds.** A payment that cannot be applied (wrong amount, a cancelled order, a second payment) is recorded in `payments` and flagged in `audit_log` as `payment.mismatch`, `payment.late` or `payment.duplicate`. Until the Phase 3 admin screens exist, check for these with SQL and refund in the Paystack dashboard.
