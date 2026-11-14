/**
 * 把所有加密欄位升級到「現役金鑰 + v2（綁 context）」格式。
 *
 * 會處理的欄位（= src/db/schema.ts 裡所有 *_enc 欄位；auth-schema.ts 沒有 src/lib/crypto.ts
 * 的密文）。context 一律來自 src/lib/field-contexts.ts，跟執行期的讀寫是同一套：
 *   employees.national_id_enc                    org
 *   employee_bank_accounts.account_number_enc    org + employee_id
 *   org_integrations.credentials_enc             org + provider
 *   org_integrations.token_cache_enc             org + provider
 *
 * 什麼時候要跑：
 *   - 從單一 FIELD_ENCRYPTION_KEY 升級上來之後：把 v1（沒綁 context）與 v2:legacy 換成 keyring 的現役金鑰。
 *   - 換金鑰之後：FIELD_ENCRYPTION_KEYS 最前面放新的一把、舊的留著，跑這支 --apply，
 *     dry run 顯示 needsReencrypt 全為 0 之後才能把舊金鑰（或 FIELD_ENCRYPTION_KEY）拿掉。
 *
 * 用法：
 *   bun run scripts/reencrypt-fields.ts                  # dry run（預設）：只印筆數，不寫入
 *   bun run scripts/reencrypt-fields.ts --apply          # 真的寫入
 *   bun run scripts/reencrypt-fields.ts --batch-size 500 # 每批讀幾列（預設 200）
 *
 * 需要 DATABASE_URL 與跟正式環境 Worker secret 相同的 FIELD_ENCRYPTION_KEYS（以及還有舊密文時的
 * FIELD_ENCRYPTION_KEY）。bun 會自動讀 .env.local；別的環境檔用 `bun --env-file=… run …`。
 *
 * 安全性質（刻意的設計，不要拿掉）：
 *   - 絕不印出明文、密文或 context（context 含 organization id），只印各欄位的計數。
 *   - dry run 也會實際解密一次（結果只留在記憶體），所以「解不開」會在動任何資料之前就被數出來。
 *   - 寫回時帶 `WHERE id = ? AND <欄位> = <舊密文>`：跑的同時有人改了那一列，就不覆蓋，
 *     記成 conflict，重跑一次就好。冪等：已經是現役金鑰的列不會再被選中處理。
 *   - 每批的 UPDATE 用 db.batch 送出（neon-http 的 batch 是同一個交易）。
 *   - 沒有 organization_id 的列無法產生 context，記成 missingOrg、不動。
 *
 * ⚠️ v1 密文當初沒有綁 context，這支會把它綁到「它現在所在的那一列」。如果有人曾經把
 * v1 密文搬到別列，那筆會被綁在搬過去的位置 —— 這是 v1 本身的弱點，升級後就不會再發生。
 */
import { and, asc, eq, gt, isNotNull, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { employeeBankAccounts, employees, orgIntegrations } from "@/db/schema";
import {
  activeKeyId,
  decryptField,
  encryptField,
  hasFieldEncryptionKey,
  needsReencrypt,
} from "@/lib/crypto";
import {
  employeeAccountNumberContext,
  employeeNationalIdContext,
  integrationCredentialsContext,
  integrationTokenCacheContext,
} from "@/lib/field-contexts";

const apply = process.argv.includes("--apply");
const batchSize = (() => {
  const i = process.argv.indexOf("--batch-size");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 200;
  if (!Number.isInteger(n) || n < 1 || n > 5000) throw new Error("--batch-size must be an integer 1–5000");
  return n;
})();

type Row = { id: number; enc: string | null; orgId: string | null; extra: string | number | null };

type Target = {
  label: string;
  table: PgTable;
  id: AnyPgColumn;
  enc: AnyPgColumn;
  /** enc 在 drizzle 表定義上的屬性名（.set() 吃的是屬性名，不是 DB 欄位名；寫錯會被默默忽略）。 */
  encKey: string;
  orgId: AnyPgColumn;
  /** context 需要的第二個不可變欄位（沒有就 null）。 */
  extra: AnyPgColumn | null;
  context: (orgId: string, extra: string | number | null) => string;
};

const TARGETS: Target[] = [
  {
    label: "employees.national_id_enc",
    table: employees,
    id: employees.id,
    enc: employees.nationalIdEnc,
    encKey: "nationalIdEnc",
    orgId: employees.organizationId,
    extra: null,
    context: (orgId) => employeeNationalIdContext(orgId),
  },
  {
    label: "employee_bank_accounts.account_number_enc",
    table: employeeBankAccounts,
    id: employeeBankAccounts.id,
    enc: employeeBankAccounts.accountNumberEnc,
    encKey: "accountNumberEnc",
    orgId: employeeBankAccounts.organizationId,
    extra: employeeBankAccounts.employeeId,
    context: (orgId, employeeId) => employeeAccountNumberContext(orgId, Number(employeeId)),
  },
  {
    label: "org_integrations.credentials_enc",
    table: orgIntegrations,
    id: orgIntegrations.id,
    enc: orgIntegrations.credentialsEnc,
    encKey: "credentialsEnc",
    orgId: orgIntegrations.organizationId,
    extra: orgIntegrations.provider,
    context: (orgId, provider) => integrationCredentialsContext(orgId, String(provider)),
  },
  {
    label: "org_integrations.token_cache_enc",
    table: orgIntegrations,
    id: orgIntegrations.id,
    enc: orgIntegrations.tokenCacheEnc,
    encKey: "tokenCacheEnc",
    orgId: orgIntegrations.organizationId,
    extra: orgIntegrations.provider,
    context: (orgId, provider) => integrationTokenCacheContext(orgId, String(provider)),
  },
];

type Counts = {
  scanned: number;
  upToDate: number;
  needsReencrypt: number;
  reencrypted: number;
  conflict: number;
  missingOrg: number;
  unrecognized: number;
  decryptFailed: number;
};

function emptyCounts(): Counts {
  return {
    scanned: 0,
    upToDate: 0,
    needsReencrypt: 0,
    reencrypted: 0,
    conflict: 0,
    missingOrg: 0,
    unrecognized: 0,
    decryptFailed: 0,
  };
}

type Planned = { id: number; oldEnc: string; newEnc: string };

/** 一列 → 要寫回的新密文（不需要處理時回 null）。只動計數，不印任何資料。 */
async function planRow(t: Target, r: Row, c: Counts): Promise<Planned | null> {
  c.scanned++;
  if (!r.enc) return null;
  let stale: boolean;
  try {
    stale = needsReencrypt(r.enc);
  } catch {
    c.unrecognized++;
    return null;
  }
  if (!stale) {
    c.upToDate++;
    return null;
  }
  c.needsReencrypt++;
  if (!r.orgId) {
    c.missingOrg++;
    return null;
  }
  try {
    const context = t.context(r.orgId, r.extra);
    const plain = await decryptField(r.enc, context);
    return { id: r.id, oldEnc: r.enc, newEnc: await encryptField(plain, context) };
  } catch {
    c.decryptFailed++;
    return null;
  }
}

async function writeBatch(t: Target, planned: Planned[], c: Counts) {
  if (planned.length === 0) return;
  const db = getDb();
  const queries = planned.map((p) =>
    db
      .update(t.table)
      .set({ [t.encKey]: p.newEnc } as never)
      .where(and(eq(t.id, p.id), eq(t.enc, p.oldEnc)))
      .returning({ id: t.id }),
  );
  const results = (await db.batch(queries as unknown as Parameters<typeof db.batch>[0])) as unknown as unknown[][];
  for (const rows of results) {
    if (rows.length > 0) c.reencrypted++;
    else c.conflict++;
  }
}

async function processTarget(t: Target): Promise<Counts> {
  const db = getDb();
  const c = emptyCounts();
  let lastId = 0;
  for (;;) {
    const where: SQL | undefined = and(isNotNull(t.enc), gt(t.id, lastId));
    const rows = (await db
      .select({
        id: t.id,
        enc: t.enc,
        orgId: t.orgId,
        extra: t.extra ?? t.orgId,
      })
      .from(t.table)
      .where(where)
      .orderBy(asc(t.id))
      .limit(batchSize)) as Row[];
    if (rows.length === 0) break;
    lastId = rows.at(-1)!.id;

    const planned: Planned[] = [];
    for (const r of rows) {
      const p = await planRow(t, t.extra ? r : { ...r, extra: null }, c);
      if (p) planned.push(p);
    }
    if (apply) await writeBatch(t, planned, c);
    if (rows.length < batchSize) break;
  }
  return c;
}

function print(label: string, c: Counts) {
  console.log(`\n${label}`);
  for (const [k, v] of Object.entries(c)) {
    if (k === "reencrypted" && !apply) continue;
    if (k === "conflict" && !apply) continue;
    console.log(`  ${k}: ${v}`);
  }
}

/** encKey 打錯時 .set() 不會報錯、只會什麼都不寫，所以啟動時先對一次。 */
function assertTargetKeys() {
  for (const t of TARGETS) {
    const cols = t.table as unknown as Record<string, unknown>;
    if (cols[t.encKey] !== t.enc) throw new Error(`internal: encKey mismatch for ${t.label}`);
  }
}

async function main() {
  assertTargetKeys();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!hasFieldEncryptionKey()) throw new Error("FIELD_ENCRYPTION_KEYS / FIELD_ENCRYPTION_KEY is not set");
  // 金鑰格式不對就在讀任何資料之前失敗。
  const probe = await encryptField("probe", "self-test");
  if ((await decryptField(probe, "self-test")) !== "probe") throw new Error("field encryption self-test failed");

  console.log(apply ? "Mode: APPLY (writing changes)" : "Mode: dry run (no writes; pass --apply to write)");
  console.log(`Active key id: ${activeKeyId()}  batch size: ${batchSize}`);

  let blocking = 0;
  for (const t of TARGETS) {
    const c = await processTarget(t);
    print(t.label, c);
    blocking += c.missingOrg + c.unrecognized + c.decryptFailed + c.conflict;
  }
  if (blocking > 0) {
    console.log(
      "\nSome rows could not be upgraded (missingOrg / unrecognized / decryptFailed / conflict)." +
        " Do NOT remove old keys yet. decryptFailed usually means a key is missing from the keyring;" +
        " conflict means the row changed while running — just re-run.",
    );
    process.exitCode = 2;
  }
}

main().catch((e) => {
  // 只印錯誤訊息，不印可能含資料的物件。drizzle 的查詢錯誤會把參數（密文）串在訊息後面，一律截掉。
  const msg = e instanceof Error ? e.message : "re-encryption failed";
  console.error(msg.split(/\bparams:/)[0].trim());
  process.exit(1);
});
