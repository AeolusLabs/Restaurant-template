# Phase 6 build log

QR codes with source attribution. Plan: `docs/superpowers/plans/2026-11-18-phase-6-qr-codes.md`. Built inline on branch `phase-6-qr-codes` (cut from `phase-5-promos-customers`), test first, one commit per task. Final state: 69 test files, 775 tests passing, typecheck, lint and production build clean. Migrations 0023 and 0024 are applied to the dev database.

## What exists

- **QR codes** for any place the restaurant advertises. A manager names one ("Lekki flyer"), and gets a printable code with its name, plus PNG and SVG downloads. The code holds `<APP_URL>/q/<slug>`; the slug is 8 random characters with no look-alikes and never changes.
- **A scan** is a visit to that address. It is counted, a 7 day cookie remembers the code, and the person lands on the menu. A switched-off or unknown code still lands on the menu, but is not counted or remembered.
- **Attribution.** An order placed while the cookie is present stores the source (`orders.source_id`), for pickup and delivery. Last touch within 7 days.
- **The report** on `/admin/qr` and each code's page, for 7, 30, 90 days or all time: scans, orders (paid) and completed sales. A refunded or unfinished order is not sales.
- **Privacy.** A scan stores a source and a time. Nothing about the visitor: no address, no browser, no account (a test checks the table's columns).
- **Access.** Managers and owners only (row-level security and role checks); the system role records scans; customers and the kitchen read nothing. Changes are audited. A source is switched off, never deleted.

## Rulings

The plan's seven rulings stand. Added while building:

- **One new dependency, `qrcode`,** isolated in `src/lib/qr.ts`. Writing a QR encoder (Reed-Solomon error correction) by hand was not worth the risk.
- **HEAD requests to a scan address are answered but not counted,** because link previews and crawlers often use HEAD.
- **An order never fails because of its QR code.** If the slug is unknown, switched off or malformed the order is placed without a source.
- **The source is looked up inside the order's transaction** by a `SECURITY DEFINER` function that returns an active source's id to someone who holds the slug (it restores `app.definer_ok`, like the Phase 5 functions).
- **Downloads are authenticated:** the image route checks the session and the role, and sends `Cache-Control: private, no-store`.

## Verified live (real database, mock payment)

Made "Lekki flyer" in the admin; a real QR code rendered; the PNG (7 KB) and SVG (1.5 KB) downloads worked; signed out and scanned the address twice, plus once for a code that does not exist; signed in as a customer and paid a pickup order; the report showed 2 scans, 1 order, and no sales yet (the order was not completed).

## Not verified

- **A scanner reading the printed code.** The code was looked at, and its construction is the library's, but no phone scanned it. Do this before printing anything: scan it from a printout at the size you will use.
- **The cookie across a real phone's browser** (in-app browsers, private mode) and behind Cloudflare. The cookie is `httpOnly`, `sameSite=lax` and `secure` in production.
- **The print layout.** The page hides the navigation and the controls when printed, but I did not print one.
- **The pages at phone width.**
- Test discipline: the QR library tests and their code were written in one step, so I did not watch those fail first. The rest was test first.
- Everything still unverified from earlier phases (Chowdeck, Paystack, Railway, Cloudflare, PgBouncer, Docker).

## Known gaps

- Scans are visits, not people: the same person scanning twice counts twice, and bots can add scans. Orders are the real measure.
- Attribution is last touch only; there is no first-touch or split credit.
- A code cannot apply a promo by itself, and a QR code for a table or a dine-in order does not exist (the system has no dine-in).
- No chart or trend over time; the dashboard is Phase 7.
- If the customer's browser blocks cookies, the scan counts but the order is not credited.
