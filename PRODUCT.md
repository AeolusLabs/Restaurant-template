# Product

## Register

product

## Users

**Customers** order pickup or delivery from a phone, usually in a hurry and often deciding in the moment. They need to find the menu fast, pay with Paystack without friction, and know where their order is afterwards. The site must be fully responsive and fit whatever device the customer opens it on, from a small phone to a desktop.

**Kitchen staff** work from a wall-mounted or counter screen in a bright, busy kitchen. They read it from a distance, with wet or gloved hands, and cannot afford to mis-tap. They need to see new orders, what to cook next, and what is ready.

**Owners and managers** run the business from the admin. They check revenue, repeat customers, peak hours and delivery cost against delivery fees collected, and they manage the menu, staff, promos, customers and AI agents. They are not technical, and they should never need a developer for routine changes. The admin must be as responsive as the customer site, so an owner can reach every tool and read the dashboard from a phone, a tablet or a desktop.

**Job to be done:** take a paid, correct order from the customer to the kitchen to the customer's hands, and show the owner what is working.

## Product Purpose

`restaurant-template` is a single-tenant restaurant ordering platform: a customer site and an admin site. It ships first for one real client and then serves as the base for future restaurant projects, each deployed on its own. It is not multi-tenant.

Branding and business settings (name, logo, colors, currency, timezone, hours, delivery zones, tax and service charge, feature flags) live in one config file. Menu, promos, customers and orders live in the database. The design must therefore stay neutral and structural, so a new restaurant changes configuration and content, not components.

Success is a restaurant taking real paid orders on day one, a kitchen that runs from the screen without asking questions, and an owner who can see what is happening without exporting a spreadsheet.

## Brand Personality

Quick, easy to use, trustworthy.

The voice is short and concrete. It says what happened and what to do next, in everyday words, without cleverness or exclamation marks. Prices are exact and formatted for the configured currency. The emotional goals are confidence at the moment of payment, calm in the kitchen at the peak of service, and control for the owner.

As a template, the personality is a baseline. Each client's own brand sits on top through config and does not replace it.

## Anti-references

- Delivery-marketplace dark patterns: countdown timers, fake scarcity, fees that appear only at the last step, and pre-ticked upsells.
- Aggregator clutter where every surface is a promo banner and the menu is hard to find.
- Cold enterprise dashboards: rows of big-number tiles, decorative charts, and data that never says what to do.
- Generic template landing pages that look machine-made: stock gradients, identical feature-card grids, and empty hero claims.
- A client's look baked into components, so that the next restaurant needs code changes to look like itself.
- Kitchen screens that depend on color alone, or that need a tap to reveal what has just arrived.

## Design Principles

1. **The order is the product.** Every screen shortens the path from hungry to paid. Anything that does not help someone choose, pay or track an order earns its place some other way.
2. **Honest money.** The total, fees, delivery charge and any discount are shown before payment and never change afterwards. Money is exact, and the interface never rounds it away.
3. **Glanceable under pressure.** The kitchen and the owner read quickly and act once. Status, urgency and next action are visible without scrolling or decoding, and destructive actions need a deliberate second step.
4. **Neutral by default, branded by config.** Structure, spacing and behavior stay consistent across every deployment. Identity arrives through tokens and content, so reuse costs a settings change.
5. **Say what happened.** When a payment, a delivery or a sync fails, tell the customer or staff member what occurred and the next step, plainly. Silence and generic errors are treated as bugs.

## Accessibility & Inclusion

Target WCAG 2.2 AA across the customer site and the admin.

- Touch targets at least 44 by 44 pixels, with extra size and spacing on the kitchen display.
- Status and urgency never rely on color alone: pair every color with text or an icon.
- High contrast and large type on the kitchen display, readable from across a room.
- Visible keyboard focus, full keyboard operation in the admin, and sensible labels for screen readers.
- Respect reduced-motion settings. Motion is limited to short transitions that confirm an action.
- Fully responsive on every surface, customer site and admin alike: usable from small phones to desktop, at 200 percent zoom, and without horizontal scrolling. Admin tools and the dashboard must stay reachable and readable on a phone.
- Consent, privacy, and data export and deletion screens written in plain language, since the product handles personal data under NDPR and GDPR.
- Currency, time and number formats come from config, not hard-coded assumptions.
