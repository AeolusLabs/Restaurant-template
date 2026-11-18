/** What each kind of alert means and what to do about it, in plain words for the people running the restaurant. */
export function alertText(kind: string, payload: Record<string, unknown> = {}): string {
  switch (kind) {
    case "payment_mismatch":
      return "A payment came in for the wrong amount and was not applied. Check the payment provider and refund it if the money was taken.";
    case "payment_late":
      return "A payment arrived after the order was cancelled. The customer has paid for nothing: refund them.";
    case "payment_duplicate":
      return "A customer paid twice for one order. Refund the extra payment from the payment provider.";
    case "refund_failed":
      return "A refund did not go through. Open the order and try the refund again.";
    case "delivery_failed": {
      // The order is already cancelled and refunded; only the rider is left to stop.
      if (payload.action === "cancel_rider") {
        const ref = typeof payload.providerRef === "string" && payload.providerRef ? ` (booking ${payload.providerRef})` : "";
        return `An order was cancelled and refunded, but its rider could not be cancelled. Cancel the rider with the delivery provider${ref} so nobody turns up.`;
      }
      const base = "A delivery could not be arranged or finished. Open the order, then retry the delivery or cancel and refund it.";
      return typeof payload.reason === "string" && payload.reason ? `${base} Reason: ${payload.reason}` : base;
    }
    case "wallet_low":
      return "The delivery wallet is running low. Top it up with the delivery provider so riders can still be booked.";
    case "delivery_stuck": {
      const detail = typeof payload.detail === "string" ? payload.detail : "A delivery looks stuck";
      const code = typeof payload.orderCode === "string" ? ` (order ${payload.orderCode})` : "";
      return `${detail}${code}. Open the order and check the delivery, or call the rider.`;
    }
    case "anomaly":
      return `An agent noticed something unusual: ${typeof payload.detail === "string" ? payload.detail : "see the order or customer"}. Take a look.`;
    case "support_question": {
      const q = typeof payload.question === "string" ? payload.question.slice(0, 200) : "";
      const from = typeof payload.from === "string" ? payload.from : "a customer";
      return `The WhatsApp assistant could not answer a question from ${from}${q ? `: "${q}"` : ""}. Reply to them yourself.`;
    }
    default:
      return kind;
  }
}
