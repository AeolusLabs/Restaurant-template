// Prints the INSERT that seeds order_transitions from the TypeScript matrix.
// Usage: pnpm exec tsx scripts/gen-transitions-sql.ts   (paste the output into the migration)
import { TRANSITIONS } from "../src/domain/orders/transitions";

const rows = TRANSITIONS.flatMap((r) => {
  const scopes = r.fulfilment ? [r.fulfilment] : ["any"];
  return scopes.map((s) => `  ('${r.from}', '${r.to}', '${s}', ARRAY[${r.actors.map((a) => `'${a}'`).join(", ")}])`);
});
console.log(`INSERT INTO order_transitions (from_status, to_status, fulfilment_scope, actors) VALUES\n${rows.join(",\n")};`);
