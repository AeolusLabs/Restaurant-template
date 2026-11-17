import { afterAll, describe, expect, test } from "vitest";
import { ORDER_STATUSES } from "../src/domain/orders/statuses";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

afterAll(closeFixtures);

const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await admin().query(sql, params)).rows as T[];

describe("application schema", () => {
  test("every _minor column is bigint", async () => {
    const cols = await rows<{ table_name: string; column_name: string; data_type: string }>(
      `select table_name, column_name, data_type from information_schema.columns
       where table_schema = 'public' and (column_name like '%\\_minor' or column_name like '%\\_minor\\_snapshot')`,
    );
    expect(cols.length).toBeGreaterThan(10);
    for (const c of cols) expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe("bigint");
  });

  test("no column in the public schema uses real, double precision or numeric", async () => {
    const bad = await rows(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and data_type in ('real', 'double precision', 'numeric')`,
    );
    expect(bad).toEqual([]);
  });

  test("inserting two payments with the same reference fails", async () => {
    const { userId } = await makeUser();
    const { orderId } = await makeOrder(userId);
    const insert = () =>
      admin().query(
        `insert into payments (order_id, provider, reference, amount_minor, currency) values ($1, 'mock', 'ref-dup', 100000, 'NGN')`,
        [orderId],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/unique/i);
  });

  test("inserting two webhook_events with the same provider and event_id fails", async () => {
    const insert = (provider: string) =>
      admin().query(`insert into webhook_events (provider, event_id, event_type, payload) values ($1, 'evt-1', 'x', '{}')`, [provider]);
    await insert("mock");
    await expect(insert("mock")).rejects.toThrow(/unique/i);
    await expect(insert("other")).resolves.toBeDefined();
  });

  test("order_status enum values equal ORDER_STATUSES in order", async () => {
    const [r] = await rows<{ v: string[] }>(`select enum_range(null::order_status)::text[] as v`);
    expect(r.v).toEqual([...ORDER_STATUSES]);
  });

  test("profiles.role defaults to customer", async () => {
    const id = (await makeUser()).userId;
    await admin().query(`update profiles set role = 'owner' where id = $1`, [id]);
    const other = (await rows<{ id: string }>(`insert into "user" (name, email) values ('d', 'd@example.com') returning id`))[0].id;
    const [p] = await rows<{ role: string }>(`insert into profiles (id, full_name) values ($1, 'd') returning role`, [other]);
    expect(p.role).toBe("customer");
  });

  test("deleting an order removes its items and contacts but is blocked once it has a payment", async () => {
    const { userId } = await makeUser();
    const free = (await makeOrder(userId)).orderId;
    await admin().query(`insert into order_contacts (order_id, phone, address_snapshot) values ($1, '0800', '{}')`, [free]);
    await admin().query(
      `insert into order_items (order_id, name_snapshot, unit_price_minor_snapshot, quantity, line_total_minor) values ($1, 'Jollof', 100000, 1, 100000)`,
      [free],
    );
    await admin().query(`delete from orders where id = $1`, [free]);
    expect((await rows(`select 1 from order_items where order_id = $1`, [free])).length).toBe(0);
    expect((await rows(`select 1 from order_contacts where order_id = $1`, [free])).length).toBe(0);

    const paid = (await makeOrder(userId)).orderId;
    await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency) values ($1, 'mock', 'ref-keep', 100000, 'NGN')`, [paid]);
    await expect(admin().query(`delete from orders where id = $1`, [paid])).rejects.toThrow(/foreign key|violates/i);
  });

  test("negative prices and zero quantities are rejected", async () => {
    await expect(
      admin().query(`insert into menu_categories (slug, name) values ('c-neg', 'C')`),
    ).resolves.toBeDefined();
    const [{ id }] = await rows<{ id: string }>(`select id from menu_categories where slug = 'c-neg'`);
    await expect(
      admin().query(`insert into menu_items (category_id, slug, name, price_minor) values ($1, 'neg', 'Neg', -1)`, [id]),
    ).rejects.toThrow(/check/i);
    const { userId } = await makeUser();
    const { orderId } = await makeOrder(userId);
    await expect(
      admin().query(
        `insert into order_items (order_id, name_snapshot, unit_price_minor_snapshot, quantity, line_total_minor) values ($1, 'x', 100, 0, 0)`,
        [orderId],
      ),
    ).rejects.toThrow(/check/i);
  });
});
