import type { Metadata } from "next";
import Link from "next/link";
import { restaurantConfig as c } from "../../../../config/restaurant";
import { LegalPage, contactLine } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>{c.name} is responsible for the personal information described here.</p>
      <h2>What we collect</h2>
      <ul>
        <li>Your name, email address and password (stored scrambled, never in readable form).</li>
        <li>Your phone number, so we can reach you about an order.</li>
        <li>Your orders, notes and payment records. Card details go straight to our payment provider and are never seen or stored by us.</li>
        <li>Your choices about marketing messages, and when you made them.</li>
      </ul>
      <h2>Why we use it</h2>
      <p>To take and prepare your orders, take payment, keep financial records, and, only if you agree, send you news and offers.</p>
      <h2>Who sees it</h2>
      <p>
        Our staff see what they need to prepare and hand over your order. Our payment provider processes your payment. We do not sell your information.
      </p>
      <h2>Your rights</h2>
      <ul>
        <li>
          Download a copy of your data, or delete your account, any time from <Link href="/account/data" className="font-semibold text-brand underline underline-offset-4">Your data</Link>.
        </li>
        <li>Change or withdraw your marketing choice from your account page.</li>
        <li>
          Deleting your account removes your details. Past orders and payments stay on record, without your name, phone number or notes, because we must keep
          financial records.
        </li>
      </ul>
      <h2>Contact</h2>
      <p>Questions about your information: {contactLine()}.</p>
    </LegalPage>
  );
}
