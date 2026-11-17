import type { TestProject } from "vitest/node";
import { startTestDb, type DbUrls } from "./helpers/db";

declare module "vitest" {
  export interface ProvidedContext {
    dbUrls: DbUrls;
  }
}

export default async function setup(project: TestProject) {
  const db = await startTestDb();
  project.provide("dbUrls", db.urls);
  return async () => {
    await db.stop();
  };
}
