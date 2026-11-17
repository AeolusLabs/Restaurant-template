import { defineModule } from "../types";

export default defineModule({
  id: "delivery",
  description: "Delivery to the customer's address, with a zone check, a fee and rider tracking.",
  feature: "delivery",
  requiresProviders: ["delivery", "notification"],
});
