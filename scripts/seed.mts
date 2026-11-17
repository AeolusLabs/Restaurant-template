import "dotenv/config";
import { closePools } from "@/db/context";
import { seedMenu } from "../db/seed/menu";
import { seedOwnerFromEnv } from "../db/seed/owner";

try {
  const menu = await seedMenu();
  console.log(`Menu seeded: ${menu.categories} categories, ${menu.items} items.`);
  const owner = await seedOwnerFromEnv(process.env);
  console.log(owner.created ? "First owner created." : "No owner created (variables unset, or the account already exists).");
} finally {
  await closePools();
}
