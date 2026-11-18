import type { CartLine, PricingItem } from "../pricing/price-cart";

/**
 * A believable cart for a fictional customer: one to three different dishes, one or two of each, with the choices a
 * dish requires and now and then an optional one. `rng` returns [0, 1), so a seeded one gives the same cart every time.
 */
export function pickLines(menu: readonly PricingItem[], rng: () => number): CartLine[] {
  const lines: CartLine[] = [];
  const picked = new Set<string>();
  for (let l = 0, want = 1 + Math.floor(rng() * 3); l < want; l++) {
    const item = menu[Math.floor(rng() * menu.length)];
    if (picked.has(item.id)) continue;
    picked.add(item.id);
    const modifierIds: string[] = [];
    for (const g of item.groups) {
      const options = g.modifiers.filter((m) => m.available);
      const need = Math.max(g.minSelect, rng() < 0.3 ? 1 : 0);
      for (const m of options.slice(0, Math.min(need, g.maxSelect))) modifierIds.push(m.id);
    }
    lines.push({ itemId: item.id, quantity: rng() < 0.25 ? 2 : 1, modifierIds });
  }
  return lines;
}
