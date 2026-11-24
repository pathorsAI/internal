import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getDb, resolveDriver, runBatch } from "./index";
import { listProjects, listTransactions, listUnassignedContracts } from "./queries";

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
  // 專案損益（src/db/project-links.ts）：經由合約 / 訂閱 / 請款項連到專案的交易都要算進去，
  // 而且同一筆交易同時命中好幾條路徑時只算一次。資料都掛在一個專用的 organization 底下，跑完清掉。
  describe("project P&L through contracts / subscriptions / billing items", () => {
    const ORG = "_pg_smoke_project_pnl";
    const ids: Record<string, number> = {};
    const one = async (q: ReturnType<typeof sql>) => {
      const r = (await getDb().execute(q)) as unknown as { rows: { id: number }[] };
      return Number(r.rows[0].id);
    };
    const cleanup = async () => {
      for (const table of ["transactions", "billing_items", "subscriptions", "contracts", "projects", "parties"]) {
        await getDb().execute(sql`delete from ${sql.raw(table)} where organization_id = ${ORG}`);
      }
      await getDb().execute(sql`delete from organization where id = ${ORG}`);
    };

    beforeAll(async () => {
      await cleanup();
      await getDb().execute(sql`insert into organization (id, name, slug) values (${ORG}, 'pg smoke', ${ORG})`);
      ids.party = await one(sql`insert into parties (organization_id, name) values (${ORG}, 'Smoke 客戶') returning id`);
      for (const name of ["A", "B", "C"]) {
        ids[name] = await one(sql`insert into projects (organization_id, name) values (${ORG}, ${name}) returning id`);
      }
      ids.cA = await one(sql`insert into contracts (organization_id, customer_party_id, project_id, title, status)
        values (${ORG}, ${ids.party}, ${ids.A}, '合約 A', 'active') returning id`);
      ids.cB = await one(sql`insert into contracts (organization_id, customer_party_id, project_id, title, status)
        values (${ORG}, ${ids.party}, ${ids.B}, '合約 B', 'completed') returning id`);
      ids.cLoose = await one(sql`insert into contracts (organization_id, customer_party_id, title, status)
        values (${ORG}, ${ids.party}, '沒歸專案', 'active') returning id`);
      // 訂閱沒有自己的專案，靠所屬合約 A 歸到 A
      ids.sA = await one(sql`insert into subscriptions (organization_id, customer_party_id, contract_id, name, amount, start_date)
        values (${ORG}, ${ids.party}, ${ids.cA}, '月費', 10, '2026-01-01') returning id`);
      ids.bA = await one(sql`insert into billing_items (organization_id, customer_party_id, contract_id, title, amount)
        values (${ORG}, ${ids.party}, ${ids.cA}, '第一期', 100) returning id`);
      ids.bB = await one(sql`insert into billing_items (organization_id, customer_party_id, project_id, title, amount)
        values (${ORG}, ${ids.party}, ${ids.B}, 'B 的請款', 30) returning id`);
      const txn = (q: ReturnType<typeof sql>) => getDb().execute(q);
      // 三條路徑同時命中 A：只能算一次
      await txn(sql`insert into transactions (organization_id, txn_date, type, amount, currency, project_id, contract_id, billing_item_id)
        values (${ORG}, '2026-02-01', 'income', 100, 'TWD', ${ids.A}, ${ids.cA}, ${ids.bA})`);
      await txn(sql`insert into transactions (organization_id, txn_date, type, amount, currency, subscription_id)
        values (${ORG}, '2026-02-02', 'income', 50, 'TWD', ${ids.sA})`);
      // 外幣：用 amount_twd
      await txn(sql`insert into transactions (organization_id, txn_date, type, amount, amount_twd, currency, contract_id)
        values (${ORG}, '2026-02-03', 'income', 10, 300, 'USD', ${ids.cA})`);
      await txn(sql`insert into transactions (organization_id, txn_date, type, amount, currency, billing_item_id)
        values (${ORG}, '2026-02-04', 'expense', 30, 'TWD', ${ids.bB})`);
      await txn(sql`insert into transactions (organization_id, txn_date, type, amount, currency, contract_id)
        values (${ORG}, '2026-02-05', 'income', 200, 'TWD', ${ids.cB})`);
      // 交易自己標 A、合約卻在 B：只歸 A（優先順序：交易自己的專案優先），B 不重複算
      await txn(sql`insert into transactions (organization_id, txn_date, type, amount, currency, project_id, contract_id)
        values (${ORG}, '2026-02-07', 'income', 7, 'TWD', ${ids.A}, ${ids.cB})`);
      // 已刪除的交易不算
      await txn(sql`insert into transactions (organization_id, txn_date, type, amount, currency, project_id, deleted_at)
        values (${ORG}, '2026-02-06', 'income', 999, 'TWD', ${ids.A}, now())`);
    });

    afterAll(cleanup);

    test("listProjects sums every linked path once, in TWD", async () => {
      const rows = await listProjects(ORG);
      const by = Object.fromEntries(rows.map((r) => [r.name, r]));
      expect(by.A.income).toBe(457);
      expect(by.A.expense).toBe(0);
      expect(by.B.income).toBe(200);
      expect(by.B.expense).toBe(30);
      expect(by.C.income).toBe(0);
      expect(by.A.derivedStatus).toBe("active");
      expect(by.B.derivedStatus).toBe("completed");
      expect(by.B.readyToClose).toBe(true);
      expect(by.C.derivedStatus).toBe("empty");
    });

    test("filtering transactions by project uses the same membership", async () => {
      const rows = await listTransactions(ORG, { projectId: ids.A }, 50);
      expect(rows.map((r) => Number(r.amount)).sort((a, b) => a - b)).toEqual([7, 10, 50, 100]);
    });

    test("listUnassignedContracts only returns contracts without a project", async () => {
      const rows = await listUnassignedContracts(ORG);
      expect(rows.map((r) => r.title)).toEqual(["沒歸專案"]);
    });
  });
});
