import type { Metadata } from "next";
import { restaurantConfig as c } from "../../../../config/restaurant";
import { LegalPage, contactLine } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>These terms cover orders you place with {c.name} through this website.</p>
      <h2>Orders and prices</h2>
      <ul>
        <li>The prices, charges and total are shown before you pay and do not change after you pay.</li>
        <li>An order is confirmed when your payment succeeds. If a payment does not complete, no order is placed and you are not charged.</li>
        <li>An unpaid order is held for a short time and then cancelled.</li>
      </ul>
      <h2>Pickup</h2>
      <p>Collect your order at the time you chose, and show your order code at the counter.</p>
      <h2>Cancellations and refunds</h2>
      <p>
        You can cancel an unpaid order at any time. If you need to cancel an order you have paid for, contact us as soon as you can on {contactLine()}.
        If we cancel an order, or cannot make it, we refund you in full.
      </p>
      <h2>Your account</h2>
      <p>Keep your password private. You can delete your account at any time from the Your data page.</p>
      <h2>Contact</h2>
      <p>{c.name}, {c.address.line1}, {c.address.city}. {contactLine()}.</p>
    </LegalPage>
  );
}
