import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getDb, resolveDriver, runBatch } from "./index";

// driver 的自動判斷是純函式，不需要資料庫，永遠跑。
describe("resolveDriver", () => {
  test("Neon hosts default to neon-http", () => {
    expect(resolveDriver("postgresql://u:p@ep-x-123.ap-southeast-1.aws.neon.tech/db?sslmode=require", undefined)).toBe(
      "neon-http",
    );
  });
  test("everything else defaults to pg", () => {
    expect(resolveDriver("postgres://app:app@db:5432/app", undefined)).toBe("pg");
    expect(resolveDriver("postgres://u:p@notneon.tech.example.com/db", undefined)).toBe("pg");
    expect(resolveDriver("host=localhost dbname=app", undefined)).toBe("pg");
  });
  test("DATABASE_DRIVER wins over the hostname", () => {
    expect(resolveDriver("postgresql://u:p@ep-x.neon.tech/db", "pg")).toBe("pg");
    expect(resolveDriver("postgres://localhost/db", "neon-http")).toBe("neon-http");
  });
  test("an unknown DATABASE_DRIVER is an error, not a silent fallback", () => {
    expect(() => resolveDriver("postgres://localhost/db", "postgres")).toThrow(/DATABASE_DRIVER/);
  });
});

// 下面要一個真的 Postgres：CI 的 postgres.yml 會設 PG_SMOKE_URL，本機沒設就跳過。
// 刻意不用 DATABASE_URL 判斷：開發機的 .env.local 多半指著 dev / prod 資料庫，
// 測試不該因為「剛好有設」就對它建表寫資料。
const url = process.env.PG_SMOKE_URL;
const TABLE = sql.raw("_pg_smoke");

describe.skipIf(!url)("getDb() on node-postgres", () => {
  beforeAll(async () => {
    // getDb() 第一次存取時才建 client，所以在這之前設好就會走 pg。
    process.env.DATABASE_URL = url as string;
    process.env.DATABASE_DRIVER = "pg";
    // 同一個 bun 行程裡若有別的測試先觸發過 connect()，client 會已經指向別的資料庫。
    // 在建表之前確認真的連到 PG_SMOKE_URL，否則寧可整組失敗也不要寫到別人的庫。
    const pool = (getDb() as unknown as { $client: { options?: { connectionString?: string } } }).$client;
    if (pool.options?.connectionString !== url) {
      throw new Error("getDb() is not connected to PG_SMOKE_URL; refusing to run DDL");
    }
    await getDb().execute(sql`drop table if exists ${TABLE}`);
    await getDb().execute(sql`create table ${TABLE} (id int primary key, note text not null)`);
  });

  afterAll(async () => {
    await getDb().execute(sql`drop table if exists ${TABLE}`);
    // 不關掉連線池的話 bun 會等著閒置連線逾時才結束。
    await (getDb() as unknown as { $client: { end(): Promise<void> } }).$client.end();
  });

  test("simple select", async () => {
    const result = await getDb().execute<{ one: number }>(sql`select 1::int as one`);
    expect((result as unknown as { rows: { one: number }[] }).rows).toEqual([{ one: 1 }]);
  });

  test("migrations ran: a known table is queryable", async () => {
    const result = await getDb().execute(sql`select count(*)::int as n from parties`);
    expect((result as unknown as { rows: { n: number }[] }).rows[0].n).toBeGreaterThanOrEqual(0);
  });

  test("runBatch commits every statement and returns results in order", async () => {
    const [first, second] = await runBatch((q) => [
      q.execute(sql`insert into ${TABLE} (id, note) values (1, 'a') returning id`),
      q.execute(sql`insert into ${TABLE} (id, note) values (2, 'b') returning id`),
    ]);
    expect((first as unknown as { rows: unknown[] }).rows).toEqual([{ id: 1 }]);
    expect((second as unknown as { rows: unknown[] }).rows).toEqual([{ id: 2 }]);
    const count = await getDb().execute(sql`select count(*)::int as n from ${TABLE}`);
    expect((count as unknown as { rows: { n: number }[] }).rows[0].n).toBe(2);
  });

  test("runBatch rolls back everything when one statement fails", async () => {
    await expect(
      runBatch((q) => [
        q.execute(sql`insert into ${TABLE} (id, note) values (3, 'should vanish')`),
        // 與 party-merge 的守門句同一招：除以零讓整批失敗。
        q.execute(sql`select 1 / 0`),
      ]),
    ).rejects.toThrow();
    const rows = await getDb().execute(sql`select id from ${TABLE} where id = 3`);
    expect((rows as unknown as { rows: unknown[] }).rows).toEqual([]);
  });
});
