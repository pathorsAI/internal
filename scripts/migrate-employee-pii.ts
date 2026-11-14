/**
 * 一次性搬移：把員工的明文個資搬進 migrations/0024 的加密欄位。
 *
 *   (1) employees.salary_account（舊的自由文字薪轉帳戶）
 *       → 這位員工還沒有任何帳戶：建一個 employee_bank_accounts（帳號加密、設為
 *         薪資預設、戶名帶員工姓名），然後清空 salary_account。
 *       → 已經有帳戶：解密比對，若某個帳戶的帳號就是這串舊值，只清空 salary_account；
 *         對不上的列入「需人工確認」，不動。
 *   (2) employees.national_id（明文身分證字號）
 *       → national_id_enc 還是空的：加密寫入 national_id_enc，清空 national_id。
 *       → 兩欄都有值：解密比對，一致就清空明文；不一致列入「需人工確認」，不動。
 *
 * ⚠️ migrations/0035 會刪掉這兩個明文欄位，而且在還有任何非 NULL 值時拒絕執行 ——
 * 套用 0035 之前一定要先用這支（--apply）把資料清乾淨。0035 套用之後這支就沒有用了
 * （欄位已不存在）。src/db/schema.ts 已經沒有這兩欄，所以這裡用本地的
 * legacyEmployees 表定義去讀寫它們。
 *
 * 用法（先確認 0024 已經套用）：
 *   bun run scripts/migrate-employee-pii.ts            # dry run，只印筆數
 *   bun run scripts/migrate-employee-pii.ts --apply    # 真的寫入
 *
 * 需要 DATABASE_URL 與 FIELD_ENCRYPTION_KEYS / FIELD_ENCRYPTION_KEY（bun 會自動讀 .env.local；要指定別的
 * 環境檔就用 `bun --env-file=.dev.vars run scripts/migrate-employee-pii.ts`）。
 * 金鑰必須跟正式環境的 Worker secret 是同一組，否則寫進去的密文網頁端解不開。
 * 密文用 src/lib/field-contexts.ts 的 context 綁組織（與員工），沒有 organization_id
 * 的員工列無法加密，會被列為 missingOrg、不動。
 *
 * 安全性質（刻意的設計，不要拿掉）：
 *   - 冪等：已經搬過的列不會再被選到，重跑只會處理剩下的。
 *   - 每位員工的「建帳戶 + 清空舊欄位」用 runBatch 在同一個交易裡完成，中途失敗
 *     不會留下「帳戶建了但明文還在」或反過來的狀態。
 *   - 只印筆數，絕不印出帳號、身分證字號或員工姓名。
 *   - 軟刪除的員工一樣處理：明文不該因為人離職被刪除就留在資料庫裡。
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { getDb, runBatch } from "@/db";
import { employeeBankAccounts } from "@/db/schema";
import { decryptField, encryptField, hasFieldEncryptionKey } from "@/lib/crypto";
import { employeeAccountNumberContext, employeeNationalIdContext } from "@/lib/field-contexts";
import {
  LEGACY_ACCOUNT_NOTE,
  accountLast5,
  normalizeAccountNumber,
  parseLegacySalaryAccount,
} from "@/lib/employee-accounts";

const apply = process.argv.includes("--apply");

type Counts = Record<string, number>;

function bump(c: Counts, key: string) {
  c[key] = (c[key] ?? 0) + 1;
}

type Db = ReturnType<typeof getDb>;
type LegacyAccount = NonNullable<ReturnType<typeof parseLegacySalaryAccount>>;
// 0035 之前的 employees 欄位（只列這支腳本用得到的）。
const employees = pgTable("employees", {
  id: bigint({ mode: "number" }).primaryKey(),
  organizationId: text("organization_id"),
  name: text().notNull(),
  nationalId: text("national_id"),
  nationalIdEnc: text("national_id_enc"),
  salaryAccount: text("salary_account"),
});
type EmployeeRow = typeof employees.$inferSelect;
type SalaryRow = Pick<EmployeeRow, "id" | "organizationId" | "name" | "salaryAccount">;
type NationalIdRow = Pick<EmployeeRow, "id" | "organizationId" | "nationalId" | "nationalIdEnc">;

/** 既有帳戶裡是否已經有這串帳號（解密後正規化比對）。 */
async function anyAccountMatches(
  existing: { enc: string }[],
  accountNumber: string,
  context: string,
): Promise<boolean> {
  const target = normalizeAccountNumber(accountNumber);
  for (const a of existing) {
    if (normalizeAccountNumber(await decryptField(a.enc, context)) === target) return true;
  }
  return false;
}

/** 建帳戶 + 清空舊欄位，同一個交易。 */
async function createAccountFromLegacy(db: Db, e: SalaryRow & { organizationId: string }, parsed: LegacyAccount) {
  const values: typeof employeeBankAccounts.$inferInsert = {
    organizationId: e.organizationId,
    employeeId: e.id,
    kind: parsed.kind,
    bankCode: parsed.bankCode,
    branchCode: parsed.branchCode,
    bankName: parsed.bankName,
    accountHolder: e.name,
    accountNumberEnc: await encryptField(
      parsed.accountNumber,
      employeeAccountNumberContext(e.organizationId, e.id),
    ),
    accountLast5: accountLast5(parsed.accountNumber),
    currency: "TWD",
    defaultForSalary: true,
    defaultForReimbursement: false,
    isActive: true,
    note: LEGACY_ACCOUNT_NOTE,
  };
  // 兩句都用 runBatch 給的 q 建，pg 上才會落在同一個交易裡。
  await runBatch((q) => [q.insert(employeeBankAccounts).values(values), clearSalaryAccount(q, e.id)], db);
}

function clearSalaryAccount(db: Db, id: number) {
  return db.update(employees).set({ salaryAccount: null }).where(eq(employees.id, id));
}

/** 處理一位員工的 salary_account，回傳計數用的分類。 */
async function migrateSalaryAccount(db: Db, e: SalaryRow): Promise<string> {
  const parsed = parseLegacySalaryAccount(e.salaryAccount ?? "");
  if (!parsed?.accountNumber) {
    // 只有空白：直接清空
    if (apply) await clearSalaryAccount(db, e.id);
    return "blankCleared";
  }
  if (!e.organizationId) return "missingOrg";
  const orgId = e.organizationId;

  const existing = await db
    .select({ enc: employeeBankAccounts.accountNumberEnc })
    .from(employeeBankAccounts)
    .where(and(eq(employeeBankAccounts.employeeId, e.id), isNull(employeeBankAccounts.deletedAt)));

  if (existing.length === 0) {
    if (apply) await createAccountFromLegacy(db, { ...e, organizationId: orgId }, parsed);
    return parsed.kind === "bank" ? "createdBank" : "createdOther";
  }

  // 已經有帳戶：舊值若已經在其中之一，就只是還沒清掉的明文
  const context = employeeAccountNumberContext(orgId, e.id);
  if (!(await anyAccountMatches(existing, parsed.accountNumber, context))) return "needsReview";
  if (apply) await clearSalaryAccount(db, e.id);
  return "alreadyMigratedCleared";
}

async function migrateSalaryAccounts(): Promise<Counts> {
  const db = getDb();
  const counts: Counts = {};
  const rows = await db
    .select({
      id: employees.id,
      organizationId: employees.organizationId,
      name: employees.name,
      salaryAccount: employees.salaryAccount,
    })
    .from(employees)
    .where(isNotNull(employees.salaryAccount));

  for (const e of rows) bump(counts, await migrateSalaryAccount(db, e));
  return counts;
}

function clearNationalId(db: Db, id: number) {
  return db.update(employees).set({ nationalId: null }).where(eq(employees.id, id));
}

/** 處理一位員工的 national_id，回傳計數用的分類。 */
async function migrateNationalId(db: Db, e: NationalIdRow): Promise<string> {
  const plain = e.nationalId?.trim() ?? "";
  if (!plain) {
    if (apply) await clearNationalId(db, e.id);
    return "blankCleared";
  }
  if (!e.organizationId) return "missingOrg";
  const context = employeeNationalIdContext(e.organizationId);
  if (!e.nationalIdEnc) {
    if (apply) {
      await db
        .update(employees)
        .set({ nationalIdEnc: await encryptField(plain, context), nationalId: null })
        .where(eq(employees.id, e.id));
    }
    return "encrypted";
  }
  if ((await decryptField(e.nationalIdEnc, context)) !== plain) return "needsReview";
  if (apply) await clearNationalId(db, e.id);
  return "alreadyEncryptedCleared";
}

async function migrateNationalIds(): Promise<Counts> {
  const db = getDb();
  const counts: Counts = {};
  const rows = await db
    .select({
      id: employees.id,
      organizationId: employees.organizationId,
      nationalId: employees.nationalId,
      nationalIdEnc: employees.nationalIdEnc,
    })
    .from(employees)
    .where(isNotNull(employees.nationalId));

  for (const e of rows) bump(counts, await migrateNationalId(db, e));
  return counts;
}

function print(title: string, counts: Counts) {
  const entries = Object.entries(counts);
  console.log(`\n${title}`);
  if (entries.length === 0) {
    console.log("  (nothing to do)");
    return;
  }
  for (const [k, v] of entries) console.log(`  ${k}: ${v}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!hasFieldEncryptionKey()) throw new Error("FIELD_ENCRYPTION_KEYS / FIELD_ENCRYPTION_KEY is not set");
  // 先試一次加解密，金鑰格式不對就在動任何資料之前失敗
  const probe = await encryptField("probe", "self-test");
  if ((await decryptField(probe, "self-test")) !== "probe") throw new Error("field encryption self-test failed");

  console.log(apply ? "Mode: APPLY (writing changes)" : "Mode: dry run (no writes; pass --apply to write)");
  print("salary_account → employee_bank_accounts", await migrateSalaryAccounts());
  print("national_id → national_id_enc", await migrateNationalIds());
  console.log(
    "\nneedsReview / missingOrg rows were left untouched: fix them (web app → employee → 帳戶 / 身分證, or set organization_id), then re-run.",
  );
}

main().catch((e) => {
  // 只印錯誤訊息，不印可能含資料的物件。drizzle 的查詢錯誤會把參數（姓名、密文）
  // 串在訊息後面，一律截掉。
  const msg = e instanceof Error ? e.message : "migration failed";
  console.error(msg.split(/\bparams:/)[0].trim());
  process.exit(1);
});
