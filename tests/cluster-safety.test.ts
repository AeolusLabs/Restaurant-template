import net from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { assertRealPostgres } from "../scripts/lib/bootstrap";
import { assertPortFree } from "../scripts/lib/cluster";

const open: net.Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))));
});

function occupy(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, host, () => {
      open.push(srv);
      resolve((srv.address() as net.AddressInfo).port);
    });
  });
}

describe("dev database safety guards", () => {
  test("assertPortFree rejects a port already used on 127.0.0.1", async () => {
    const port = await occupy("127.0.0.1");
    await expect(assertPortFree(port)).rejects.toThrow(/already in use/);
  });

  test("assertPortFree rejects a port already used on ::1", async () => {
    let port: number;
    try {
      port = await occupy("::1");
    } catch {
      return; // IPv6 loopback not available on this machine
    }
    await expect(assertPortFree(port)).rejects.toThrow(/already in use/);
  });

  test("assertPortFree accepts a free port", async () => {
    const port = await occupy("127.0.0.1");
    await open.pop()!.close();
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  test("assertRealPostgres refuses a PGlite server", async () => {
    const pglite = { query: async () => ({ rows: [{ version: "PostgreSQL 18.6 (PGlite 0.5.16) on wasm3" }] }) };
    await expect(assertRealPostgres(pglite as never)).rejects.toThrow(/PGlite/);
  });

  test("assertRealPostgres refuses anything older than PostgreSQL 18", async () => {
    const old = { query: async () => ({ rows: [{ version: "PostgreSQL 16.2 on x86_64-pc-linux-gnu" }] }) };
    await expect(assertRealPostgres(old as never)).rejects.toThrow(/PostgreSQL 18/);
  });

  test("assertRealPostgres accepts PostgreSQL 18", async () => {
    const ok = { query: async () => ({ rows: [{ version: "PostgreSQL 18.6 on x86_64-pc-linux-gnu, compiled by gcc" }] }) };
    await expect(assertRealPostgres(ok as never)).resolves.toBeUndefined();
  });
});
