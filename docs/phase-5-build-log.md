# Phase 5 build log

Promos and customer management. Plan: `docs/superpowers/plans/2026-11-18-phase-5-promos-customers.md`. Built inline on branch `phase-5-promos-customers` (cut from `phase-4-delivery`), test first, one commit per task. Final state: 65 test files, 736 tests passing, typecheck, lint and production build clean. Migrations 0018 to 0022 are applied to the dev database.

## What exists

- **Promo codes** with three kinds: percentage off the items (with an optional cap), a fixed amount off the items, and free delivery. Each can have a minimum order, a start and end time, a total number of uses and a number of uses per customer (default once). One code per order; codes never combine.
- **Pricing.** A percentage or fixed discount comes off the items before the service charge and tax, so charges are worked out on what the customer actually pays for. Free delivery sets the order's delivery fee to nothing. A promo that would make an order free is refused, because nothing could be paid.
- **Checkout.** A code field with Apply. The server looks the code up and prices it; the page shows the discount, or a plain reason the code cannot be used (unknown, not started, expired, used up, already used, delivery only, minimum order, switched off). The order stores the discount and the code, and the order page, tracker and admin order page show them.
- **Limits that hold under load.** Placing an order takes a lock on the code, counts uses, and records the redemption in the same transaction, so two customers cannot both take the last use (tested). An order cancelled while still unpaid (expired, or abandoned) gives its use back, by a database trigger, so it holds for any path that cancels.
- **Admin promos** (`/admin/promos`, only when `features.promos` is on): list with status, what each does, how often it has been used and what it has given away; create; edit; switch on and off. Promos are never deleted. Every change is in the audit log.
- **Admin customers** (`/admin/customers`): search by name, email or phone, order by recent, spend, orders or joined; a customer page with contact details, marketing consent, totals, every order, and block or unblock.

## Rulings

The plan's eleven rulings stand. Added while building:

- **Customers cannot read the promos table.** A code is looked up by `promo_for_code()`, a `SECURITY DEFINER` function that returns one row to someone who already knows the code. Usage counts come from `promo_usage()`, which refuses a customer asking about someone else.
- **The release trigger restores `app.definer_ok`.** `transition_order` sets that flag and still needs it after the trigger runs; the trigger puts back whatever it found.
- **`promo_redemptions.profile_id` is nullable,** because deleting a customer account deletes the profile. The redemption stays as a record of what the promo cost.
- **The code is copied onto the order** (`orders.promo_code`, migration 0022), so customers and staff can see which code an order used without reading the promos table.
- **"Orders" on the customer screens means paid orders,** and **spend means completed orders only.** A refunded order is not spend.
- **A promo edit never changes a placed order.** The discount is stored on the order.
- **Free delivery is recorded as a waived fee** on the redemption, and the order's delivery fee is 0, so the delivery record says the customer paid nothing and the rider's cost is the restaurant's.

## Found by the tests

- **A check constraint that let a percentage promo with no value through.** `value between 1 and 10000` is NULL when `value` is NULL, and a NULL check passes. Fixed in migration 0021 by saying outright that value must be present (and a test now pins it).

## Verified live (real database, mock payment)

Created SAVE10 in the admin form; applied it in lower case at checkout (₦3,800 to ₦3,420, discount line and recalculated charges); paid; the order page showed "Discount (SAVE10) -₦380.00"; a second attempt by the same customer said "You have already used that code."; the customers list showed the customer with their orders and spend.

## Not verified

- **Promo and customer screens at phone width,** and the customer page's block and unblock buttons in a browser (the database function is tested in `tests/rbac.test.ts`).
- **A promo with a start or end time through the form in a browser.** The parsing and timezone handling are tested (`tests/promo-form.test.ts`), the date pickers were not used.
- **Free delivery and a fixed-amount code were exercised only by tests,** not in the browser.
- Test discipline: the `previewPromo` and the `staffDeliveryLabel` (Phase 4) tests were each written in the same step as their code, so I did not watch those fail first. The rest was test first.
- Everything still unverified from earlier phases (Chowdeck, Paystack, Railway, Cloudflare, PgBouncer, Docker).

## Known gaps

- Promo codes are typed by customers only: no link that applies a code, no "first order only" rule, no per-item or per-category promos. Win-back offers are for the agents in Phase 8.
- The promo list is not paged or searchable.
- A manager sees customers' emails and phone numbers (needed to run the restaurant); there is no separate permission for that.
- No customer notes, tags or segments, and no export of the customer list. The dashboard (repeat customers, lifetime value) is Phase 7.
- A blocked customer's open orders are not touched.
