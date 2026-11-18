import { sql } from "drizzle-orm";
import { afterAll, describe, expect, inject, test } from "vitest";
import { closePools, withRequestContext, withSystemContext } from "../src/db/context";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
type Ctx = Parameters<typeof withRequestContext>[0];

let n = 0;
const key = () => `agent-${Date.now().toString(36)}-${++n}`;
async function run(agentKey = key()) {
  const { rows } = await admin().query(`insert into agent_runs (agent_key, trigger, status) values ($1, 'manual', 'succeeded') returning id`, [agentKey]);
  return { id: rows[0].id as string, agentKey };
}
async function proposal(over: { mode?: string; status?: string; dedupe?: string | null; agentKey?: string } = {}) {
  const r = await run(over.agentKey);
  const { rows } = await admin().query(
    `insert into agent_proposals (run_id, agent_key, kind, summary, payload, customer_facing, mode, status, dedupe_key) values ($1, $2, 'test.kind', 'x', '{}', false, $3, $4, $5) returning id`,
    [r.id, r.agentKey, over.mode ?? "approve", over.status ?? "pending", over.dedupe === undefined ? null : over.dedupe],
  );
  return { id: rows[0].id as string, agentKey: r.agentKey, runId: r.id };
}
const seen = (ctx: Ctx, table: string, col: string, id: string) => withRequestContext(ctx, async (tx) => (await tx.execute(sql.raw(`select 1 from ${table} where ${col} = '${id}'`))).rows.length, o);
const decide = (ctx: Ctx, id: string, status: string, by: string) =>
  withRequestContext(ctx, (tx) => tx.execute(sql`update agent_proposals set status = ${status}, decided_by = ${by}::uuid, decided_at = now() where id = ${id}::uuid`), o);
const statusOf = async (id: string) => (await admin().query(`select status from agent_proposals where id = $1`, [id])).rows[0].status as string;

describe("reading agent data", () => {
  test("managers and owners read configs, runs and proposals; customers and the kitchen see nothing", async () => {
    const k = key();
    await admin().query(`insert into agent_configs (agent_key) values ($1)`, [k]);
    const p = await proposal();
    const cfgId = (await admin().query(`select id from agent_configs where agent_key = $1`, [k])).rows[0].id as string;
    for (const role of ["manager", "owner"] as const) {
      const ctx = (await makeUser(role)).ctx;
      expect(await seen(ctx, "agent_configs", "id", cfgId), role).toBe(1);
      expect(await seen(ctx, "agent_runs", "id", p.runId), role).toBe(1);
      expect(await seen(ctx, "agent_proposals", "id", p.id), role).toBe(1);
    }
    for (const role of ["customer", "kitchen"] as const) {
      const ctx = (await makeUser(role)).ctx;
      expect(await seen(ctx, "agent_configs", "id", cfgId), role).toBe(0);
      expect(await seen(ctx, "agent_runs", "id", p.runId), role).toBe(0);
      expect(await seen(ctx, "agent_proposals", "id", p.id), role).toBe(0);
    }
  });
});

describe("changing an agent's settings", () => {
  test("only an owner can create or change a config", async () => {
    const owner = (await makeUser("owner")).ctx;
    const k = key();
    await withRequestContext(owner, (tx) => tx.execute(sql`insert into agent_configs (agent_key, enabled) values (${k}, true)`), o);
    await withRequestContext(owner, (tx) => tx.execute(sql`update agent_configs set autonomy = 'approve_first' where agent_key = ${k}`), o);
    expect((await admin().query(`select autonomy from agent_configs where agent_key = $1`, [k])).rows[0].autonomy).toBe("approve_first");
    for (const role of ["manager", "kitchen", "customer"] as const) {
      const ctx = (await makeUser(role)).ctx;
      await expect(withRequestContext(ctx, (tx) => tx.execute(sql`insert into agent_configs (agent_key) values (${key()})`), o), role).rejects.toThrow();
      await withRequestContext(ctx, (tx) => tx.execute(sql`update agent_configs set autonomy = 'auto' where agent_key = ${k}`), o); // nothing visible to change
      expect((await admin().query(`select autonomy from agent_configs where agent_key = $1`, [k])).rows[0].autonomy, role).toBe("approve_first");
    }
  });

  test("the database refuses an autonomy level or a cap that makes no sense", async () => {
    await expect(admin().query(`insert into agent_configs (agent_key, autonomy) values ($1, 'wild')`, [key()])).rejects.toThrow(/check/i);
    await expect(admin().query(`insert into agent_configs (agent_key, monthly_cap_minor) values ($1, -1)`, [key()])).rejects.toThrow(/check/i);
  });

  test("an agent is off and suggest-only until an owner says otherwise", async () => {
    const k = key();
    await admin().query(`insert into agent_configs (agent_key) values ($1)`, [k]);
    expect((await admin().query(`select enabled, autonomy, auto_confirmed_at, monthly_cap_minor from agent_configs where agent_key = $1`, [k])).rows[0]).toEqual({ enabled: false, autonomy: "suggest_only", auto_confirmed_at: null, monthly_cap_minor: null });
  });
});

describe("deciding a proposal", () => {
  test("a manager or owner can approve a pending proposal that was made to wait for approval, as themselves", async () => {
    for (const role of ["manager", "owner"] as const) {
      const u = await makeUser(role);
      const p = await proposal({ mode: "approve" });
      await decide(u.ctx, p.id, "approved", u.userId);
      expect(await statusOf(p.id), role).toBe("approved");
      expect((await admin().query(`select decided_by from agent_proposals where id = $1`, [p.id])).rows[0].decided_by).toBe(u.userId);
    }
  });

  test("advice can be dismissed but never approved", async () => {
    const u = await makeUser("manager");
    const p = await proposal({ mode: "advice" });
    await expect(decide(u.ctx, p.id, "approved", u.userId)).rejects.toThrow();
    expect(await statusOf(p.id)).toBe("pending");
    await decide(u.ctx, p.id, "rejected", u.userId);
    expect(await statusOf(p.id)).toBe("rejected");
  });

  test("a person cannot mark a proposal executed, expired or failed, or decide it as someone else", async () => {
    const u = await makeUser("owner");
    const other = await makeUser("manager");
    const p = await proposal();
    for (const status of ["executed", "expired", "failed", "pending"]) await expect(decide(u.ctx, p.id, status, u.userId), status).rejects.toThrow();
    await expect(decide(u.ctx, p.id, "approved", other.userId)).rejects.toThrow();
    expect(await statusOf(p.id)).toBe("pending");
  });

  test("a decided proposal cannot be decided again", async () => {
    const u = await makeUser("manager");
    const p = await proposal({ mode: "approve" });
    await decide(u.ctx, p.id, "rejected", u.userId);
    await decide(u.ctx, p.id, "approved", u.userId); // not pending any more: nothing changes
    expect(await statusOf(p.id)).toBe("rejected");
  });

  test("a person cannot change what a proposal says, only its decision", async () => {
    const u = await makeUser("owner");
    const p = await proposal();
    await expect(withRequestContext(u.ctx, (tx) => tx.execute(sql`update agent_proposals set payload = '{"x":1}' where id = ${p.id}::uuid`), o)).rejects.toThrow();
    await expect(withRequestContext(u.ctx, (tx) => tx.execute(sql`update agent_proposals set mode = 'auto' where id = ${p.id}::uuid`), o)).rejects.toThrow();
  });

  test("customers and the kitchen cannot decide anything", async () => {
    const p = await proposal();
    for (const role of ["customer", "kitchen"] as const) {
      const u = await makeUser(role);
      await decide(u.ctx, p.id, "approved", u.userId).catch(() => undefined);
      expect(await statusOf(p.id), role).toBe("pending");
    }
  });

  test("the system runs the whole lifecycle, including executed", async () => {
    const p = await proposal({ mode: "auto" });
    await withSystemContext((tx) => tx.execute(sql`update agent_proposals set status = 'executed', executed_at = now() where id = ${p.id}::uuid`), { url: urls.system });
    expect(await statusOf(p.id)).toBe("executed");
  });
});

describe("runs and duplicates", () => {
  test("nobody in the app role can write a run, and the database refuses a bad trigger or status", async () => {
    const owner = (await makeUser("owner")).ctx;
    await expect(withRequestContext(owner, (tx) => tx.execute(sql`insert into agent_runs (agent_key, trigger) values ('x', 'manual')`), o)).rejects.toThrow();
    await expect(admin().query(`insert into agent_runs (agent_key, trigger) values ('x', 'whenever')`)).rejects.toThrow(/check/i);
    await expect(admin().query(`insert into agent_runs (agent_key, trigger, status) values ('x', 'manual', 'great')`)).rejects.toThrow(/check/i);
  });

  test("one open proposal per key: a duplicate is refused while the first is pending or approved, and allowed once it is closed", async () => {
    const k = key();
    const a = await proposal({ agentKey: k, dedupe: "customer-1" });
    await expect(proposal({ agentKey: k, dedupe: "customer-1" })).rejects.toThrow(/unique|duplicate/i);
    await proposal({ agentKey: k, dedupe: "customer-2" }); // another key is fine
    await admin().query(`update agent_proposals set status = 'executed' where id = $1`, [a.id]);
    await proposal({ agentKey: k, dedupe: "customer-1" }); // the first is closed
  });

  test("the same key under another agent is a different proposal", async () => {
    await proposal({ agentKey: key(), dedupe: "same" });
    await proposal({ agentKey: key(), dedupe: "same" });
  });
});
