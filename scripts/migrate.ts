/**
 * 把 migrations/*.sql 依檔名順序套到 DATABASE_URL 指的 Postgres（任何 Postgres 都行，
 * 一律走 node-postgres 的 TCP 連線，不管 app 本身用哪個 driver）。
 *
 * 用法：
 *   bun scripts/migrate.ts                 # 套用還沒套過的檔案
 *   bun scripts/migrate.ts --dry-run       # 只列出會套哪些，不寫入
 *   bun scripts/migrate.ts --mark-applied-through 0033_party_aliases.sql
 *                                          # 既有資料庫導入用：把到這支為止的檔案
 *                                          # 記成「已套用」但不執行（見下方說明）
 *   bun run db:apply                       # 同第一行
 *
 * 需要 DATABASE_URL（bun 會自動讀 .env / .env.local）。
 *
 * 設計（刻意的，不要拿掉）：
 *   - 已套用的檔案記在 `_migrations`（filename、checksum、applied_at）。重跑只會處理
 *     還沒記錄的檔案，所以可以放心每次部署都跑。
 *   - 每個檔案自己一個交易：中途失敗只 rollback 那一支，不會留下半套的 schema，也不會
 *     把前面已經成功的檔案一起退掉。migrations/ 裡的檔案因此不能自己寫 BEGIN / COMMIT，
 *     也不能用 CREATE INDEX CONCURRENTLY 這類不能在交易裡跑的語句。
 *   - 已套用檔案的 checksum 變了就拒絕執行：migration 是 forward-only，改舊檔不會讓
 *     已經跑過的資料庫跟著變，只會讓新舊環境的 schema 默默分岔。要改就新增一支。
 *   - 用 advisory lock 擋同時兩個人跑（例如兩個部署撞在一起），第二個會等第一個跑完。
 *   - 不寫死 0000_baseline.sql：檔案有就照順序套，沒有也不影響。
 *
 * 既有資料庫（在這支腳本出現前就用 psql 手動套過 migration 的）第一次用時，
 * `_migrations` 是空的，直接跑會把 0001 之後非冪等的檔案再套一次而失敗。先用
 * `--mark-applied-through <最後一支已套用的檔名>` 把歷史記上，之後就正常跑。
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(import.meta.dir, "..", "migrations");
// 任意但固定的數字：同一個資料庫上所有跑這支腳本的行程搶同一把鎖。
const ADVISORY_LOCK_KEY = 7_412_190_331;

type MigrationFile = { filename: string; sql: string; checksum: string };
type AppliedRow = { filename: string; checksum: string };

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const i = argv.indexOf("--mark-applied-through");
  const markThrough = i === -1 ? null : argv[i + 1];
  if (i !== -1 && (!markThrough || markThrough.startsWith("--"))) {
    throw new Error("--mark-applied-through needs a migration filename");
  }
  return { dryRun, markThrough };
}

function loadMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) // 位元組順序，不受 locale 影響
    .map((filename) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
      return { filename, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

async function main() {
  const { dryRun, markThrough } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const files = loadMigrations();
  if (markThrough && !files.some((f) => f.filename === markThrough)) {
    throw new Error(`--mark-applied-through: ${markThrough} is not in migrations/`);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    // dry run 保證零寫入：連 _migrations 都不建，沒有這張表就當成全部未套用。
    // 鎖是 session 層級的，client.end() 時自動釋放，不用另外 unlock。
    const tableExists = (
      await client.query<{ exists: boolean }>("SELECT to_regclass('public._migrations') IS NOT NULL AS exists")
    ).rows[0].exists;
    if (!tableExists && !dryRun) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          filename text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )`);
    }
    const applied = new Map<string, string>(
      tableExists
        ? (await client.query<AppliedRow>("SELECT filename, checksum FROM _migrations")).rows.map((r) => [
            r.filename,
            r.checksum,
          ])
        : [],
    );

    // 先全部檢查完再動手：有任何一支被改過就一支都不套。
    const changed = files.filter((f) => applied.has(f.filename) && applied.get(f.filename) !== f.checksum);
    if (changed.length) {
      throw new Error(
        `checksum mismatch for already-applied migration(s): ${changed.map((f) => f.filename).join(", ")}. ` +
          "Applied migrations must not be edited; add a new migration instead.",
      );
    }
    const missing = [...applied.keys()].filter((name) => !files.some((f) => f.filename === name));
    if (missing.length) {
      console.warn(`warning: recorded in _migrations but not on disk: ${missing.join(", ")}`);
    }

    const pending = files.filter((f) => !applied.has(f.filename));
    if (!pending.length) {
      console.log(`up to date (${applied.size} applied)`);
      return;
    }

    const markIndex = markThrough ? pending.findIndex((f) => f.filename === markThrough) : -1;
    for (const [i, file] of pending.entries()) {
      const markOnly = i <= markIndex;
      const verb = markOnly ? "mark" : "apply";
      if (dryRun) {
        console.log(`[dry-run] would ${verb} ${file.filename}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        if (!markOnly) await client.query(file.sql);
        await client.query("INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)", [
          file.filename,
          file.checksum,
        ]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file.filename} failed: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
      console.log(`${markOnly ? "marked" : "applied"} ${file.filename}`);
    }
    if (dryRun) console.log(`[dry-run] ${pending.length} pending, nothing written`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
