// 員工收款帳戶與身分證字號的資料層（server only）。網頁 action、MCP tool 共用。
//
// 安全性質（刻意的設計，不要拿掉）：
// - 帳號只以密文寫入（encryptField），讀取一律投影成 MaskedEmployeeAccount，
//   select 清單裡根本不含 account_number_enc —— 列表路徑沒有機會把密文或明文帶出去。
// - 解密只有兩個入口：revealEmployeeAccountNumber（呼叫端必須先確認 owner/admin
//   並寫 activity_log）與 readNationalId（server 端用來遮罩或給 owner/admin 編輯）。
// - 「預設帳戶」的切換用 db.batch 送出：neon-http 的 batch 在同一個交易裡執行，
//   先清掉舊預設再設新預設，partial unique index 不會在中間狀態撞到。
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { getDb } from "./index";
import { employeeBankAccounts, employees } from "./schema";
import { decryptField, encryptField } from "@/lib/crypto";
import { maskNationalId } from "@/lib/pii";
import {
  EmployeeAccountError,
  LEGACY_ACCOUNT_NOTE,
  accountLast5,
  bankNameForCode,
  checkAccountCodes,
  checkAccountNumber,
  isAccountKind,
  parseLegacySalaryAccount,
  type EmployeeAccountKind,
  type MaskedEmployeeAccount,
} from "@/lib/employee-accounts";

type Db = ReturnType<typeof getDb>;

/** 遮罩後的欄位投影。不含 account_number_enc。 */
const maskedColumns = {
  id: employeeBankAccounts.id,
  employeeId: employeeBankAccounts.employeeId,
  kind: employeeBankAccounts.kind,
  bankCode: employeeBankAccounts.bankCode,
  branchCode: employeeBankAccounts.branchCode,
  bankName: employeeBankAccounts.bankName,
  accountHolder: employeeBankAccounts.accountHolder,
  accountLast5: employeeBankAccounts.accountLast5,
  currency: employeeBankAccounts.currency,
  label: employeeBankAccounts.label,
  defaultForSalary: employeeBankAccounts.defaultForSalary,
  defaultForReimbursement: employeeBankAccounts.defaultForReimbursement,
  isActive: employeeBankAccounts.isActive,
  note: employeeBankAccounts.note,
};

function notDeleted(orgId: string) {
  return and(eq(employeeBankAccounts.organizationId, orgId), isNull(employeeBankAccounts.deletedAt));
}

/**
 * 列出帳戶（遮罩）。employeeIds 省略 = 整個組織；排序：啟用中在前、預設在前、建立順序。
 */
export async function listEmployeeAccounts(
  orgId: string,
  employeeIds?: number | number[],
): Promise<MaskedEmployeeAccount[]> {
  const ids = employeeIds === undefined ? undefined : [employeeIds].flat();
  if (ids?.length === 0) return [];
  return getDb()
    .select(maskedColumns)
    .from(employeeBankAccounts)
    .where(and(notDeleted(orgId), ids ? inArray(employeeBankAccounts.employeeId, ids) : undefined))
    .orderBy(
      asc(employeeBankAccounts.employeeId),
      desc(employeeBankAccounts.isActive),
      desc(employeeBankAccounts.defaultForSalary),
      desc(employeeBankAccounts.defaultForReimbursement),
      asc(employeeBankAccounts.id),
    );
}

/** 依員工分組，給一次撈整個組織的頁面用。 */
export function groupAccountsByEmployee(
  rows: MaskedEmployeeAccount[],
): Map<number, MaskedEmployeeAccount[]> {
  const map = new Map<number, MaskedEmployeeAccount[]>();
  for (const r of rows) {
    const list = map.get(r.employeeId);
    if (list) list.push(r);
    else map.set(r.employeeId, [r]);
  }
  return map;
}

export async function getEmployeeAccount(
  orgId: string,
  id: number,
): Promise<MaskedEmployeeAccount | null> {
  const [row] = await getDb()
    .select(maskedColumns)
    .from(employeeBankAccounts)
    .where(and(notDeleted(orgId), eq(employeeBankAccounts.id, id)))
    .limit(1);
  return row ?? null;
}

async function assertEmployeeInOrg(db: Db, orgId: string, employeeId: number) {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);
  if (!row) throw new EmployeeAccountError("wrongEmployee");
}

export type EmployeeAccountInput = {
  kind?: string | null;
  bankCode?: string | null;
  branchCode?: string | null;
  bankName?: string | null;
  accountHolder?: string | null;
  /** 完整帳號（明文）。更新時省略 = 不改帳號。 */
  accountNumber?: string | null;
  currency?: string | null;
  label?: string | null;
  defaultForSalary?: boolean;
  defaultForReimbursement?: boolean;
  isActive?: boolean;
  note?: string | null;
};

function textOrNull(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

function resolveKind(v: string | null | undefined, fallback: EmployeeAccountKind): EmployeeAccountKind {
  const k = v?.trim() || fallback;
  if (!isAccountKind(k)) throw new EmployeeAccountError("kindInvalid");
  return k;
}

/** 設成預設之前，把同一位員工其他帳戶的同類預設清掉（batch 的第一句）。 */
function clearDefaultsQuery(
  db: Db,
  orgId: string,
  employeeId: number,
  flags: { salary: boolean; reimbursement: boolean },
  exceptId?: number,
) {
  const patch: { defaultForSalary?: boolean; defaultForReimbursement?: boolean; updatedAt: string } = {
    updatedAt: new Date().toISOString(),
  };
  const which = [];
  if (flags.salary) {
    patch.defaultForSalary = false;
    which.push(eq(employeeBankAccounts.defaultForSalary, true));
  }
  if (flags.reimbursement) {
    patch.defaultForReimbursement = false;
    which.push(eq(employeeBankAccounts.defaultForReimbursement, true));
  }
  return db
    .update(employeeBankAccounts)
    .set(patch)
    .where(
      and(
        notDeleted(orgId),
        eq(employeeBankAccounts.employeeId, employeeId),
        exceptId === undefined ? undefined : ne(employeeBankAccounts.id, exceptId),
        or(...which),
      ),
    );
}

/** 新增帳戶；有勾預設就在同一個交易裡清掉舊預設。回傳遮罩後的列。 */
export async function createEmployeeAccount(
  orgId: string,
  employeeId: number,
  input: EmployeeAccountInput,
): Promise<MaskedEmployeeAccount> {
  const db = getDb();
  await assertEmployeeInOrg(db, orgId, employeeId);
  const kind = resolveKind(input.kind, "bank");
  const codes = checkAccountCodes({ ...input, kind });
  const number = checkAccountNumber(kind, input.accountNumber);
  const isActive = input.isActive ?? true;
  // 停用的帳戶不能當預設：發薪 / 撥款不該預選一個已經不用的帳戶。
  const defaultForSalary = isActive && !!input.defaultForSalary;
  const defaultForReimbursement = isActive && !!input.defaultForReimbursement;

  const insert = db
    .insert(employeeBankAccounts)
    .values({
      organizationId: orgId,
      employeeId,
      kind,
      ...codes,
      bankName: textOrNull(input.bankName) ?? bankNameForCode(codes.bankCode),
      accountHolder: textOrNull(input.accountHolder),
      accountNumberEnc: await encryptField(number),
      accountLast5: accountLast5(number),
      label: textOrNull(input.label),
      defaultForSalary,
      defaultForReimbursement,
      isActive,
      note: textOrNull(input.note),
    })
    .returning(maskedColumns);

  if (defaultForSalary || defaultForReimbursement) {
    const [, inserted] = await db.batch([
      clearDefaultsQuery(db, orgId, employeeId, {
        salary: defaultForSalary,
        reimbursement: defaultForReimbursement,
      }),
      insert,
    ]);
    return inserted[0];
  }
  const [row] = await insert;
  return row;
}

type AccountPatch = Partial<typeof employeeBankAccounts.$inferInsert>;

/** 更新時沒帶的欄位（undefined）沿用既有值；null 表示明確清空，照用。 */
function orExisting<T>(next: T | undefined, existing: T): T {
  // 刻意不用 ??：null（明確清空）必須保留，只有 undefined 才沿用既有值。
  if (next === undefined) return existing;
  return next;
}

/** 新帳號 → 加密 + 末五碼；沒帶新帳號就不動（但改成銀行帳戶時必須重填）。 */
async function accountNumberPatch(
  kind: EmployeeAccountKind,
  existingKind: string,
  rawNumber: string | null | undefined,
): Promise<AccountPatch> {
  const newNumber = textOrNull(rawNumber);
  if (!newNumber) {
    // 改成銀行帳戶時，舊帳號可能不是純數字（例如舊資料的 other）→ 要求重新輸入。
    if (kind === "bank" && existingKind !== "bank") throw new EmployeeAccountError("numberDigits");
    return {};
  }
  const n = checkAccountNumber(kind, newNumber);
  return { accountNumberEnc: await encryptField(n), accountLast5: accountLast5(n) };
}

/** 銀行名稱：有帶就用（空白則依代碼帶預設）；只改代碼時跟著代碼換；都沒動回 undefined。 */
function bankNamePatch(
  input: EmployeeAccountInput,
  bankCode: string | null,
  existingBankCode: string | null,
): string | null | undefined {
  if (input.bankName !== undefined) return textOrNull(input.bankName) ?? bankNameForCode(bankCode);
  if (input.bankCode !== undefined && bankCode !== existingBankCode) return bankNameForCode(bankCode);
  return undefined;
}

/** 更新帳戶（只改有帶的欄位）。accountNumber 省略 / 空白 = 不改帳號。 */
export async function updateEmployeeAccount(
  orgId: string,
  id: number,
  input: EmployeeAccountInput,
): Promise<MaskedEmployeeAccount> {
  const db = getDb();
  const existing = await getEmployeeAccount(orgId, id);
  if (!existing) throw new EmployeeAccountError("notFound");

  const kind = input.kind === undefined ? resolveKind(existing.kind, "other") : resolveKind(input.kind, "bank");
  const codes = checkAccountCodes({
    kind,
    bankCode: orExisting(input.bankCode, existing.bankCode),
    branchCode: orExisting(input.branchCode, existing.branchCode),
    currency: orExisting(input.currency, existing.currency),
  });

  const patch: AccountPatch = {
    kind,
    ...codes,
    ...(await accountNumberPatch(kind, existing.kind, input.accountNumber)),
    updatedAt: new Date().toISOString(),
  };
  const bankName = bankNamePatch(input, codes.bankCode, existing.bankCode);
  if (bankName !== undefined) patch.bankName = bankName;
  if (input.accountHolder !== undefined) patch.accountHolder = textOrNull(input.accountHolder);
  if (input.label !== undefined) patch.label = textOrNull(input.label);
  if (input.note !== undefined) patch.note = textOrNull(input.note);

  const isActive = input.isActive ?? existing.isActive;
  patch.isActive = isActive;
  const wantSalary = isActive && (input.defaultForSalary ?? existing.defaultForSalary);
  const wantReimb = isActive && (input.defaultForReimbursement ?? existing.defaultForReimbursement);
  patch.defaultForSalary = wantSalary;
  patch.defaultForReimbursement = wantReimb;

  const update = db
    .update(employeeBankAccounts)
    .set(patch)
    .where(and(notDeleted(orgId), eq(employeeBankAccounts.id, id)))
    .returning(maskedColumns);

  const newlySalary = wantSalary && !existing.defaultForSalary;
  const newlyReimb = wantReimb && !existing.defaultForReimbursement;
  if (newlySalary || newlyReimb) {
    const [, updated] = await db.batch([
      clearDefaultsQuery(db, orgId, existing.employeeId, { salary: newlySalary, reimbursement: newlyReimb }, id),
      update,
    ]);
    return updated[0];
  }
  const [row] = await update;
  return row;
}

/** 軟刪除。已被薪資單 / 交易引用的帳戶一樣可以刪（FK 仍指得到那一列，紀錄不會壞）。 */
export async function softDeleteEmployeeAccount(orgId: string, id: number): Promise<MaskedEmployeeAccount> {
  const existing = await getEmployeeAccount(orgId, id);
  if (!existing) throw new EmployeeAccountError("notFound");
  await getDb()
    .update(employeeBankAccounts)
    .set({
      deletedAt: new Date().toISOString(),
      defaultForSalary: false,
      defaultForReimbursement: false,
    })
    .where(and(notDeleted(orgId), eq(employeeBankAccounts.id, id)));
  return existing;
}

/**
 * 解密完整帳號。**呼叫端負責**：先確認 owner/admin、事後寫 activity_log。
 * MCP 不得呼叫這支（MCP 沒有顯示完整帳號的能力）。
 */
export async function revealEmployeeAccountNumber(orgId: string, id: number): Promise<string> {
  const [row] = await getDb()
    .select({ enc: employeeBankAccounts.accountNumberEnc })
    .from(employeeBankAccounts)
    .where(and(notDeleted(orgId), eq(employeeBankAccounts.id, id)))
    .limit(1);
  if (!row) throw new EmployeeAccountError("notFound");
  return decryptField(row.enc);
}

export type PayoutPurpose = "salary" | "reimbursement";

/**
 * 發薪 / 撥款要記錄的「匯入帳戶」。
 * - 有指定 id：必須屬於這個組織、這位員工、未刪除且啟用中，否則丟錯。
 * - 沒指定：用這位員工該用途的預設帳戶；沒有預設就回 null（欄位本來就是選填）。
 */
export async function resolvePayoutAccount(
  orgId: string,
  employeeId: number | null,
  purpose: PayoutPurpose,
  explicitId?: number | null,
): Promise<MaskedEmployeeAccount | null> {
  if (explicitId != null) {
    const acct = await getEmployeeAccount(orgId, explicitId);
    if (!acct) throw new EmployeeAccountError("notFound");
    if (acct.employeeId !== employeeId) throw new EmployeeAccountError("wrongEmployee");
    if (!acct.isActive) throw new EmployeeAccountError("inactive");
    return acct;
  }
  if (employeeId == null) return null;
  const flag =
    purpose === "salary"
      ? employeeBankAccounts.defaultForSalary
      : employeeBankAccounts.defaultForReimbursement;
  const [row] = await getDb()
    .select(maskedColumns)
    .from(employeeBankAccounts)
    .where(
      and(
        notDeleted(orgId),
        eq(employeeBankAccounts.employeeId, employeeId),
        eq(employeeBankAccounts.isActive, true),
        eq(flag, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * 舊 salary_account → 一個「薪資預設」帳戶，成功後清空舊欄位（明文不再留在 DB）。
 * 已經有任何帳戶的員工不轉（避免蓋掉人手動建的預設），回傳 null。
 */
export async function convertLegacySalaryAccount(
  orgId: string,
  employeeId: number,
): Promise<MaskedEmployeeAccount | null> {
  const db = getDb();
  const [emp] = await db
    .select({ salaryAccount: employees.salaryAccount, name: employees.name })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.id, employeeId), isNull(employees.deletedAt)))
    .limit(1);
  if (!emp) throw new EmployeeAccountError("wrongEmployee");
  const parsed = emp.salaryAccount ? parseLegacySalaryAccount(emp.salaryAccount) : null;
  if (!parsed) return null;
  const existing = await listEmployeeAccounts(orgId, employeeId);
  if (existing.length > 0) return null;
  const created = await createEmployeeAccount(orgId, employeeId, {
    ...parsed,
    accountHolder: emp.name,
    currency: "TWD",
    defaultForSalary: true,
    note: LEGACY_ACCOUNT_NOTE,
  });
  await db
    .update(employees)
    .set({ salaryAccount: null })
    .where(and(eq(employees.organizationId, orgId), eq(employees.id, employeeId)));
  return created;
}

// ---- 身分證字號 ----

/** 身分證字號明文：優先解密 national_id_enc，沒有才退回舊的明文欄位。 */
export async function readNationalId(row: {
  nationalId: string | null;
  nationalIdEnc: string | null;
}): Promise<string | null> {
  if (row.nationalIdEnc) return decryptField(row.nationalIdEnc);
  return row.nationalId;
}

/** 遮罩後的身分證字號；解不開（金鑰缺失 / 密文損壞）時回固定遮罩，不讓頁面整個掛掉。 */
export async function readMaskedNationalId(row: {
  nationalId: string | null;
  nationalIdEnc: string | null;
}): Promise<string | null> {
  try {
    return maskNationalId(await readNationalId(row));
  } catch {
    return "***";
  }
}

/** 寫入用：明文 → { nationalIdEnc, nationalId: null }；空值兩欄都清空。 */
export async function nationalIdColumns(
  value: string | null | undefined,
): Promise<{ nationalId: null; nationalIdEnc: string | null }> {
  const v = value?.trim();
  return { nationalId: null, nationalIdEnc: v ? await encryptField(v) : null };
}
