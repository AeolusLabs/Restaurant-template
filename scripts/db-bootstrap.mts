import "dotenv/config";
import { bootstrapRoles } from "./lib/bootstrap";

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const password = (k: string) => decodeURIComponent(new URL(need(k)).password);

await bootstrapRoles(
  need("DATABASE_ADMIN_URL"),
  {
    migrator: password("DATABASE_MIGRATOR_URL"),
    app: password("DATABASE_URL"),
    system: password("DATABASE_SYSTEM_URL"),
  },
  new URL(need("DATABASE_MIGRATOR_URL")).pathname.slice(1),
);
console.log("Roles and database are ready.");
