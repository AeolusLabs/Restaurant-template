import { parseRestaurantConfig, type RestaurantConfig } from "./schema";

// The only place for client-specific values. Replace these per restaurant.
const raw: RestaurantConfig = {
  name: "Sample Kitchen",
  logo: null,
  colors: { primary: "oklch(55% 0.15 40)", accent: "oklch(70% 0.15 150)" },
  contact: { phone: "+234 800 000 0000", email: "hello@example.com" },
  address: { line1: "1 Sample Street", area: "Ikeja", city: "Lagos", country: "Nigeria" },
  currency: { code: "NGN", exponent: 2 },
  timezone: "Africa/Lagos",
  locale: "en-NG",
  openingHours: {
    mon: [{ open: "10:00", close: "21:00" }],
    tue: [{ open: "10:00", close: "21:00" }],
    wed: [{ open: "10:00", close: "21:00" }],
    thu: [{ open: "10:00", close: "21:00" }],
    fri: [{ open: "10:00", close: "22:00" }],
    sat: [{ open: "11:00", close: "22:00" }],
    sun: [],
  },
  pickup: { slotMinutes: 15, minLeadMinutes: 20, lastOrderCutoffMinutes: 30 },
  delivery: { dispatchOn: "accepted", zones: [{ name: "Island", feeMinor: 150_000 }], lowWalletMinor: 500_000 },
  charges: { serviceChargeBps: 500, taxBps: 750, pricesIncludeCharges: true },
  orders: { unpaidExpiryMinutes: 30, cancellationWindow: "before_acceptance" },
  features: { promos: false, pickup: true, delivery: false, ai_agents: false, demo_mode: false },
  legal: { policyVersion: "2026-11-17" },
  agents: { defaultMonthlyCapMinor: 0, modelPrices: {} },
};

export const restaurantConfig: RestaurantConfig = parseRestaurantConfig(raw);
