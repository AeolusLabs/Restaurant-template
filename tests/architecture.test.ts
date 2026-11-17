import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(__dirname, "..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full);
    return /\.(ts|tsx|mts)$/.test(name) ? [full] : [];
  });
}

const importsOf = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

const rel = (f: string) => path.relative(root, f).replaceAll("\\", "/");

describe("architecture rules", () => {
  test("no file under src/domain imports pg, next, drizzle, better-auth, the db layer or a provider implementation", () => {
    const forbidden = /^(pg|next|drizzle-orm|better-auth|@better-auth)(\/|$)|^@\/(db|auth)(\/|$)|^@\/providers\/(?!.*\/types$)/;
    const offenders = walk(path.join(root, "src/domain")).flatMap((f) =>
      importsOf(f)
        .filter((i) => forbidden.test(i) || /\/(paystack|chowdeck|s3|mock|stub|memory)$/.test(i))
        .map((i) => `${rel(f)} imports ${i}`),
    );
    expect(offenders).toEqual([]);
  });

  test("only src/db/context.ts, scripts and tests import the pg Pool", () => {
    const allowed = new Set(["src/db/context.ts"]);
    const offenders = [...walk(path.join(root, "src")), ...walk(path.join(root, "db")), ...walk(path.join(root, "config"))]
      .filter((f) => importsOf(f).includes("pg") && !allowed.has(rel(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  test("no vendor SDK is imported outside its own provider folder", () => {
    const vendors = /^(paystack|@paystack\/|@aws-sdk\/|openai|@anthropic-ai\/|twilio)/;
    const offenders = walk(path.join(root, "src")).flatMap((f) =>
      importsOf(f)
        .filter((i) => vendors.test(i) && !rel(f).startsWith("src/providers/"))
        .map((i) => `${rel(f)} imports ${i}`),
    );
    expect(offenders).toEqual([]);
  });

  test("no route handler exports a runtime (Cache Components forbids it)", () => {
    const offenders = walk(path.join(root, "src/app")).filter((f) => /export\s+const\s+runtime\b/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("dependency hygiene", () => {
  test("dev-only tooling is not a production dependency", () => {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    const devOnly = ["embedded-postgres", "tsx", "drizzle-kit", "vitest", "dotenv", "typescript", "eslint", "@types/pg"];
    expect(devOnly.filter((d) => d in pkg.dependencies)).toEqual([]);
  });
});
