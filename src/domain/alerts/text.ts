/** What each kind of alert means and what to do about it, in plain words for the people running the restaurant. */
export function alertText(kind: string): string {
  switch (kind) {
    case "payment_mismatch":
      return "A payment came in for the wrong amount and was not applied. Check the payment provider and refund it if the money was taken.";
    case "payment_late":
      return "A payment arrived after the order was cancelled. The customer has paid for nothing: refund them.";
    case "payment_duplicate":
      return "A customer paid twice for one order. Refund the extra payment from the payment provider.";
    case "refund_failed":
      return "A refund did not go through. Open the order and try the refund again.";
    default:
      return kind;
  }
}
