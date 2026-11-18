# Phase 5: Promos and customer management. Implementation plan

> Executed inline, test first, one commit per task, on branch `phase-5-promos-customers` (cut from `phase-4-delivery`).

**Goal:** A manager or owner can create promo codes (percentage, fixed amount, free delivery) with a minimum order, an expiry, a total limit and a per-customer limit. A customer applies a code at checkout, sees the discount before paying, and the server prices it. Managers and owners can also see their customers: who they are, what they have ordered and spent, and block or unblock them.

**Spec:** `docs/ARCHITECTURE.md` sections 5, 11, 17, 18 (promo calculation: percentage, fixed, free delivery, usage limits, expiry, minimum order, stacking rules); `CLAUDE.md` rules 4, 7, 9.

## Global constraints

- Money is integer kobo. The browser never sends a discount: it sends a code, and the server decides.
- A promo changes the price shown before payment and never afterwards (the order stores what was applied).
- RLS: `promos` and `promo_redemptions` are read and written by managers and owners only; customers never read the promo table (a code is looked up by a `SECURITY DEFINER` function).
- Every migration is applied to the dev database in the same task.
- `features.promos` off means no promo UI and codes are refused.

## Rulings

1. **One code per order, never stacked.** That is the stacking rule.
2. **Percentage and fixed discounts come off the items,** before service charge and tax: charges are worked out on the discounted items, so the customer is never charged tax on money they did not pay. A discount never exceeds the items subtotal. `orders.subtotal_minor` stays the undiscounted items total and `discount_minor` holds the discount.
3. **A percentage can be capped** (`max_discount_minor`).
4. **Free delivery** sets the order's delivery fee to 0 (so the delivery record says the customer paid nothing and the restaurant absorbed the rider's cost) and records the waived fee on the redemption. It applies to delivery orders only.
5. **A redemption is taken when the order is placed** and counted against the limits at once, under a per-promo lock, so two customers cannot both take the last use. It is released if the order is cancelled while still unpaid (expiry or the customer abandoning it). A paid order that is later cancelled or refunded keeps it spent.
6. **Limits:** `max_redemptions` in total and `max_per_customer` (default 1), either may be unlimited (null).
7. **Codes** are 3 to 20 characters of letters, digits, `-` and `_`, stored upper case, matched without regard to case, and unique.
8. **Promos are switched off, never deleted.** Changing a promo's terms does not change orders already placed.
9. **Customers do not see promos.** They enter a code; the server answers with a discount or a plain reason (unknown, not started, expired, used up, already used, minimum order, delivery only, switched off).
10. **Customer list** shows name, email, phone, orders, completed spend and last order. Spend counts completed orders only. Emails are shown to managers and owners only, like staff emails.
11. **Blocking** reuses the existing database function (managers may block customers; blocked people cannot sign in or order).

## Tasks

- [ ] **T1 Pure promo rules.** `src/domain/promos/`: code normalisation, eligibility (dates, limits, flag), discount calculation, stacking; `priceCart` takes an applied promo and returns the discount, the discounted charges and the waived delivery.
- [ ] **T2 Tables.** `promos`, `promo_redemptions`, RLS, `promo_for_code` and `promo_usage` functions (migrations, applied).
- [ ] **T3 Applying a promo to an order.** Look up and validate in the order transaction under a lock, record the redemption, store `promo_id` and `discount_minor`, release on unpaid cancellation; pickup and delivery orders.
- [ ] **T4 Checkout.** Code field and Apply, live quote with the discount, totals and order pages show it, admin order page shows the code.
- [ ] **T5 Admin promos.** List, create, edit, switch on and off, with redemption counts and audit entries.
- [ ] **T6 Customers.** List with search, customer page with orders and spend, block and unblock.
- [ ] **T7 Docs, live walkthrough, completion status.**
