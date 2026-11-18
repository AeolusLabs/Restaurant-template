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

## 9. Phase 3 checks before the restaurant uses the admin

1. **`DATABASE_UNPOOLED_URL`** must be set on the `web` service. The kitchen's live updates use a direct connection (LISTEN does not work through PgBouncer's transaction mode). Without it the kitchen still works, by polling every 10 seconds.
2. **Photos need real storage.** `STORAGE_PROVIDER=memory` loses every uploaded photo when the service restarts. Write the S3 adapter (docs/modules.md) and set `STORAGE_PROVIDER=s3` before the restaurant adds photos.
3. **Server-Sent Events through Cloudflare.** Open `/kitchen` on the live domain and confirm it says "Live". If it says "Not live right now", the stream is being blocked or buffered; the board still refreshes every 10 seconds.
4. **First owner.** Set `INITIAL_OWNER_EMAIL` and `INITIAL_OWNER_PASSWORD` for the first `pnpm db:seed`, sign in, add the manager and kitchen accounts from Staff, then remove the variables.
5. **Refund path with a Paystack test key.** Pay a test order, cancel it from the admin, and confirm the refund appears in the Paystack dashboard and the order shows Refunded.
6. **Alerts.** Anything on the admin home under "Needs attention" is money or an order that needs a person. Check it at the start and end of each service.

## 10. Phase 4 checks before taking delivery orders

1. **Nothing here has run against Chowdeck.** The adapter follows Chowdeck's documentation, which disagrees with itself, and Chowdeck has no sandbox: live testing spends real wallet money. Do these in order, with a small wallet balance. **verify**
2. **Base URL.** Set `CHOWDECK_API_KEY` and call the wallet balance endpoint on `https://api.chowdeck.com` and on `https://api.relay.chowdeck.com`. Use the host that answers as `CHOWDECK_BASE_URL`.
3. **One real booking.** Place a delivery order to an address you control, accept it, and watch the worker log for `dispatch-deliveries`. Check the booking in Chowdeck's dashboard. Confirm: `item_type` and `country_code` are accepted (change `itemType` and `countryCode` in `src/providers/index.ts` if not), the reference we send is the one Chowdeck returns, and each status word the rider goes through appears on the order page.
4. **Empty wallet.** Note the exact error Chowdeck returns when the wallet cannot cover a booking and tell us: the adapter recognises "insufficient", "wallet", "balance" and HTTP 402, and anything else is treated as a plain failure (still retried, then `delivery_failed`, but without the low-wallet alert).
5. **Webhooks.** If Chowdeck gives you a webhook secret, set `CHOWDECK_WEBHOOK_SECRET` and point the webhook at `/api/webhooks/delivery`. Without it every webhook is refused (401) and polling carries on alone, which is fine.
6. **The failure drill.** With `DELIVERY_PROVIDER=mock`, empty the wallet (or stop the worker) and confirm: an order that cannot be booked becomes `delivery_failed` after five attempts, the admin home shows the alert, Retry books a new rider, and Cancel and refund returns the money.
7. **Wallet alert.** Set `delivery.lowWalletMinor` to what covers a day of deliveries. The admin home shows the balance and an alert when it falls below.
8. **The worker must be running** (`pnpm worker`): it books riders, follows deliveries and checks the wallet. If it stops, paid delivery orders wait; nothing is lost.
9. **The mock rider is in memory,** per process. With `DELIVERY_PROVIDER=mock` the web server and the worker do not share riders, so cancelling from the admin raises the "rider could not be cancelled" alert. That is the mock, not a bug.

## 11. Phase 5 checks before using promos

1. **Switch them on.** Set `features.promos` to `true` in `config/restaurant.ts`. Until then the checkout has no code field, customers cannot use codes, and the Promos link is hidden.
2. **Try one end to end** with `PAYMENT_PROVIDER=mock`: create a code in Admin, Promos; place an order with it; confirm the discount appears before paying and on the order page, and that the same customer is refused a second time.
3. **Limits.** A code with a total limit stops working for everyone when it is used up, and an order that expires unpaid gives its use back. Watch the "Used N of M" figure on the promo list.
4. **Check the numbers with your accountant.** A discount comes off the items before the service charge and tax, so the tax collected falls with it. If the restaurant wants tax on the full price, that is a rule change (`priceCart`), not a setting.
5. **Free delivery costs you the rider.** The customer pays nothing for delivery but Chowdeck still charges the wallet; the delivery panel on the order shows what the customer paid against what the rider cost.
6. **Customers.** Admin, Customers shows names, emails and phone numbers to managers and owners only. Block a customer only after talking to them: a blocked person cannot sign in or order, and nothing tells them why.

## 12. Phase 6 checks before printing QR codes

1. **`APP_URL` must be the public address** (the restaurant's real domain). The code holds that address, so a code printed with the wrong one is wasted paper. Check the address shown under the code on its page before you print.
2. **Scan a printout, not the screen.** Print one code at the size you will use (a table card, a flyer) and scan it with two or three different phones. Make it large enough: at least 2 cm square for a card held in the hand, larger for a poster.
3. **Make a code per place,** and name it by where it is ("Lekki flyer", "Delivery bag"). The name is for you; the printed code does not change when you rename it.
4. **Switching a code off** keeps printed copies working (they still open the menu) but stops counting them. Do not switch off a code you still hand out if you want its numbers.
5. **Read the numbers as a guide.** Scans are visits: a link preview or a bot can add one. Orders are credited to the last code the customer scanned in the 7 days before ordering, and a customer who blocks cookies is counted as a scan but not credited with the order.
6. **The cookie** needs HTTPS in production (it is marked secure). Test the whole path on the live domain: scan, order, and look for the order under that code.

## 13. Phase 7 checks before relying on the dashboard

1. **Look at it with real orders** after a week of trading, and check a few numbers by hand: add up one day's paid orders in Admin, Orders and compare with that day's column.
2. **The timezone is `timezone` in `config/restaurant.ts`.** If days or the busiest hour look shifted, that setting is wrong.
3. **Sales leave out refunds.** A refunded order is under "Not counted", not in sales. Sales are counted on the day the customer paid.
4. **Delivery warning.** If it says delivery costs more than customers pay, change the zone fees in `config/restaurant.ts`, or reconsider free-delivery codes. It only counts deliveries a rider was booked for.
5. **On a phone,** open the dashboard and check every chart is readable and nothing scrolls sideways. This has not been tried on a real phone.
6. **Volume.** The queries read every paid order in the period. If the page becomes slow with a large history, add indexes on `payments (status, paid_at)` and tell us.
