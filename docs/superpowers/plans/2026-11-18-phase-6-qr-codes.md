# Phase 6: QR codes with source attribution. Implementation plan

> Executed inline, test first, one commit per task, on branch `phase-6-qr-codes` (cut from `phase-5-promos-customers`).

**Goal:** A manager can make a QR code for any place the restaurant advertises (a flyer, a table card, a delivery bag, a poster), print it, and later see how many people scanned it, how many of them ordered, and how much those orders were worth. A scan opens the menu; an order placed afterwards remembers which code brought the customer.

**Spec:** `docs/ARCHITECTURE.md` sections 5, 11, 18 (`qr_sources`, `orders.source_id`, admin `qr`); `CLAUDE.md` rules 2, 7, 10.

## Global constraints

- Scans store no personal data: no IP address, no browser details, no account. A scan is a timestamp against a source.
- RLS: `qr_sources` and `qr_scans` are read and written by managers and owners only (the system role records scans); customers never read them.
- Every migration is applied to the dev database in the same task.
- The one new dependency is `qrcode` (encoding a QR code needs Reed-Solomon error correction, which is not worth hand-writing). It is used in one file, `src/lib/qr.ts`.

## Rulings

1. **A code points at `<APP_URL>/q/<slug>`.** The slug is 8 random characters from an alphabet with no look-alikes, never sequential, and never changes. The label can be edited; a source is switched off, never deleted.
2. **A scan is a visit to that address.** It counts once, sets a 7 day cookie, and sends the person to the menu. Link previews and bots can also visit, so scans measure visits; orders are the real measure.
3. **Attribution is last touch within 7 days.** An order placed while the cookie is present takes the source of the most recent scan. A switched-off or unknown code still lands on the menu but is not counted and not remembered.
4. **Orders per source are paid orders; revenue is the total of completed orders,** the same definitions as the customer screens, so a refunded order is not revenue.
5. **The report covers 7, 30 or 90 days, or all time.**
6. **Customers do not read QR tables.** The order looks the source up with a `SECURITY DEFINER` function that returns an active source's id for a slug; scans are recorded by the system role.
7. **Printing:** the detail page shows the code large with its label for printing, and offers SVG (sharp at any size) and PNG downloads. Error correction is medium, so a code survives a little wear.

## Tasks

- [ ] **T1 QR images and slugs.** `src/lib/qr.ts` (SVG and PNG for a URL), slug generation and validation, the scan address.
- [ ] **T2 Tables.** `qr_sources`, `qr_scans`, the foreign key from `orders.source_id`, RLS, `qr_source_for_slug` (migrations, applied).
- [ ] **T3 Scans and attribution.** The `/q/[slug]` route, the cookie, and `source_id` set when an order is placed (pickup and delivery).
- [ ] **T4 Admin.** `/admin/qr`: list with the report, create, rename, switch on and off, the printable code and downloads.
- [ ] **T5 Docs, live walkthrough, completion status.**
