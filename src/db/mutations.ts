"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { eq, and, isNull, inArray, desc, sql } from "drizzle-orm";
import { getDb } from "./index";
import { billingItemPaidById } from "./queries";
import {
  parties,
  employees,
  bankAccounts,
  accountReconciliations,
  transactions,
  invoices,
  documents,
  categories,
  payrollRuns,
  payslips,
  payslipItems,
  projects,
  subscriptions,
  subscriptionPeriods,
  contracts,
  billingItems,
} from "./schema";
import { oauthApplication, member } from "./auth-schema";
import { uploadDocument } from "@/lib/storage";
import { requireOrg } from "@/lib/session";
import { auth } from "@/lib/auth";
import { logWeb } from "@/db/activity";
import { isValidEmail } from "@/lib/pii";
import {
  generateSchedule,
  type BillingPlan,
  type DueRule,
  type ScheduleInput,
} from "@/lib/billing-schedule";

export type ActionState = { ok: boolean; error?: string };

function str(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null) {
  const s = str(v);
  return s === null ? null : Number(s);
}

// 「類型」下拉值 → (doc_type, invoice_kind)
// 電子發票：會計師會自動在進項總表看到;其他發票(三聯式等)：要主動通知會計師
const DOC_KIND_MAP: Record<string, { docType: string; invoiceKind: string | null }> = {
  e_invoice: { docType: "invoice", invoiceKind: "electronic" },
  paper_invoice: { docType: "invoice", invoiceKind: "paper" },
  receipt: { docType: "receipt", invoiceKind: null },
  other: { docType: "other", invoiceKind: null },
};

// 憑證 / 相關證明：有附檔就建立一筆 documents；
// 另外「有報公司統編」(billed) 時，即使沒附檔也要記下發票類型（電子 / 其他）。
async function storeTransactionDocument(
  db: ReturnType<typeof getDb>,
  orgId: string,
  transactionId: number,
  formData: FormData,
  billed = false,
) {
  const file = formData.get("attachment");
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !billed) return;

  const kind = str(formData.get("docKind")) ?? "other";
  const { docType, invoiceKind } = DOC_KIND_MAP[kind] ?? DOC_KIND_MAP.other;

  let r2Key = `meta/${transactionId}-${crypto.randomUUID()}`;
  let fileName: string | null = null;
  let contentType: string | null = null;
  let sizeBytes: number | null = null;
  if (file instanceof File && file.size > 0) {
    const up = await uploadDocument(file, `transactions/${transactionId}`);
    r2Key = up.key;
    fileName = up.fileName;
    contentType = up.contentType;
    sizeBytes = up.size;
  }
  await db.insert(documents).values({
    docType,
    invoiceKind,
    r2Key,
    fileName,
    contentType,
    sizeBytes,
    transactionId,
    organizationId: orgId,
  });
}

export async function createParty(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "請輸入交易對象名稱" };

  try {
    const { orgId } = await requireOrg();
    const [inserted] = await getDb()
      .insert(parties)
      .values({
        organizationId: orgId,
        name,
        label: str(formData.get("label")) ?? "vendor",
        taxId: str(formData.get("taxId")),
        defaultCurrency: str(formData.get("defaultCurrency")),
        defaultAccountId: num(formData.get("defaultAccountId")),
        typicalAmount: str(formData.get("typicalAmount")),
        contact: str(formData.get("contact")),
        note: str(formData.get("note")),
      })
      .returning({ id: parties.id });
    await logWeb(orgId, "create", "party", inserted.id, name);
    revalidatePath("/parties");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function createReconciliation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const accountId = num(formData.get("accountId"));
  const asOfDate = str(formData.get("asOfDate"));
  const statementBalance = str(formData.get("statementBalance"));

  if (!accountId) return { ok: false, error: "請選擇帳戶" };
  if (!asOfDate) return { ok: false, error: "請選擇截止日期" };
  if (statementBalance === null) return { ok: false, error: "請輸入對帳單餘額" };

  try {
    const { orgId } = await requireOrg();
    const [inserted] = await getDb()
      .insert(accountReconciliations)
      .values({
        organizationId: orgId,
        accountId,
        asOfDate,
        statementBalance,
        note: str(formData.get("note")),
      })
      .returning({ id: accountReconciliations.id });
    await logWeb(orgId, "create", "reconciliation", inserted.id);
    revalidatePath("/reconciliation");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "新增失敗";
    return {
      ok: false,
      error: msg.includes("uq_recon_account_date")
        ? "此帳戶在該日期已有對帳紀錄"
        : msg,
    };
  }
}

async function getOrCreateParty(
  db: ReturnType<typeof getDb>,
  orgId: string,
  name: string,
  label: string,
): Promise<number> {
  const found = await db
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), eq(parties.name, name)))
    .limit(1);
  if (found.length) return found[0].id;
  const [created] = await db
    .insert(parties)
    .values({ organizationId: orgId, name, label })
    .returning({ id: parties.id });
  return created.id;
}

/**
 * 表單上的「客戶」欄一律收名稱而不是 id：使用者可以直接打一個新客戶，存檔時才
 * 建立，不必先跳去「交易對象」頁建好再回來。名稱已存在就連到既有那筆。
 *
 * 回傳 `created` 讓呼叫端決定要不要 revalidate /parties —— 沒新建就不用。
 */
async function resolvePartyName(
  db: ReturnType<typeof getDb>,
  orgId: string,
  name: string | null,
  label = "customer",
): Promise<{ id: number | null; created: boolean }> {
  if (!name) return { id: null, created: false };
  const [found] = await db
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), eq(parties.name, name)))
    .limit(1);
  if (found) return { id: found.id, created: false };
  return { id: await getOrCreateParty(db, orgId, name, label), created: true };
}

/**
 * 必填的客戶欄：名稱轉 id，查無就新建；名稱空白時回錯誤而不是 id。
 *
 * 合約與訂閱的新增／編輯都要做這件事，之前每個 mutation 各抄一遍「先檢查名稱、
 * 解析、再檢查 id」—— 後面那道檢查其實永遠跟前面同時成立，是抄出來的贅肉。
 */
async function requireCustomer(
  db: ReturnType<typeof getDb>,
  orgId: string,
  name: string | null,
): Promise<{ id: number; created: boolean } | { error: string }> {
  const party = await resolvePartyName(db, orgId, name);
  if (party.id == null) return { error: "請輸入客戶" };
  return { id: party.id, created: party.created };
}

async function getOrCreateEmployee(
  db: ReturnType<typeof getDb>,
  orgId: string,
  name: string,
): Promise<number> {
  const found = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.name, name)))
    .limit(1);
  if (found.length) return found[0].id;
  const [created] = await db
    .insert(employees)
    .values({ organizationId: orgId, name })
    .returning({ id: employees.id });
  return created.id;
}

type TxnFields = {
  fromAccountId: number | null;
  toAccountId: number | null;
  categoryId: number | null;
  partyId: number | null;
  settleEmployeeId: number | null;
};

type TxnResult = { fields: TxnFields } | { error: string };
const blankFields: TxnFields = {
  fromAccountId: null,
  toAccountId: null,
  categoryId: null,
  partyId: null,
  settleEmployeeId: null,
};

async function resolveExpenseIncome(
  db: ReturnType<typeof getDb>,
  orgId: string,
  isIncome: boolean,
  formData: FormData,
): Promise<TxnResult> {
  const accountId = num(formData.get("accountId"));
  if (!accountId) return { error: isIncome ? "請選擇收款帳戶" : "請選擇付款帳戶" };
  const partyName = str(formData.get("partyName"));
  if (!partyName) return { error: isIncome ? "請輸入客戶" : "請輸入交易對象" };
  // 分類可留空 → categoryId 為 null＝未分類（不再強制選分類，避免用另一個帳戶暫存）
  const categoryId = num(formData.get("categoryId"));
  const partyId = await getOrCreateParty(db, orgId, partyName, isIncome ? "customer" : "vendor");
  return {
    fields: {
      ...blankFields,
      categoryId,
      partyId,
      fromAccountId: isIncome ? null : accountId,
      toAccountId: isIncome ? accountId : null,
    },
  };
}

async function resolveAdvance(
  db: ReturnType<typeof getDb>,
  orgId: string,
  formData: FormData,
): Promise<TxnResult> {
  const partyName = str(formData.get("partyName"));
  if (!partyName) return { error: "請輸入廠商" };
  const categoryId = num(formData.get("categoryId")); // 可留空＝未分類
  const settleName = str(formData.get("settleEmployeeName"));
  if (!settleName) return { error: "請輸入代墊人" };
  return {
    fields: {
      ...blankFields,
      categoryId,
      partyId: await getOrCreateParty(db, orgId, partyName, "vendor"),
      settleEmployeeId: await getOrCreateEmployee(db, orgId, settleName),
    },
  };
}

function resolveTransfer(formData: FormData): TxnResult {
  const fromAccountId = num(formData.get("fromAccountId"));
  const toAccountId = num(formData.get("toAccountId"));
  if (!fromAccountId || !toAccountId) return { error: "請選擇轉出與轉入帳戶" };
  return { fields: { ...blankFields, fromAccountId, toAccountId } };
}

// 依情境（type）解析交易要寫的欄位，順便驗證；回傳欄位或錯誤訊息。
function resolveTxnFields(
  db: ReturnType<typeof getDb>,
  orgId: string,
  type: string,
  formData: FormData,
): Promise<TxnResult> | TxnResult {
  if (type === "expense" || type === "income")
    return resolveExpenseIncome(db, orgId, type === "income", formData);
  if (type === "advance") return resolveAdvance(db, orgId, formData);
  if (type === "transfer") return resolveTransfer(formData);
  return { error: "不支援的交易類型" };
}

// 情境優先：type 決定行為，各情境只讀自己需要的欄位。所有金額目前以 TWD 計。
export async function createTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const type = str(formData.get("type"));
  const txnDate = str(formData.get("txnDate"));
  const amount = str(formData.get("amount"));
  const currency = str(formData.get("currency")) ?? "TWD";

  if (!type) return { ok: false, error: "缺少交易類型" };
  if (!txnDate) return { ok: false, error: "請選擇日期" };
  if (amount === null) return { ok: false, error: "請輸入金額" };

  // 報稅與否：transfer 固定 both；其餘看「上外帳」勾選（勾→both，不勾→internal）
  const reported = type === "transfer" || formData.get("reported") === "on";
  const book = reported ? "both" : "internal";

  // 是否有報公司統編：獨立的勾選。有報統編就一定有發票，
  // 且必須知道是電子發票還是其他發票（三聯式等）。
  const billed = formData.get("billedToCompanyTaxId") === "on";
  if (billed) {
    const kind = str(formData.get("docKind"));
    if (kind !== "e_invoice" && kind !== "paper_invoice") {
      return { ok: false, error: "有報公司統編時，憑證類型必須是電子發票或其他發票" };
    }
  }

  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const resolved = await resolveTxnFields(db, orgId, type, formData);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const f = resolved.fields;

    const [inserted] = await db
      .insert(transactions)
      .values({
        organizationId: orgId,
        type,
        txnDate,
        description: str(formData.get("description")),
        categoryId: f.categoryId,
        partyId: f.partyId,
        settleEmployeeId: f.settleEmployeeId,
        projectId: num(formData.get("projectId")),
        contractId: num(formData.get("contractId")),
        subscriptionId: num(formData.get("subscriptionId")),
        subscriptionPeriod: str(formData.get("subscriptionPeriod")),
        amount,
        currency,
        amountTwd: currency === "TWD" ? amount : null,
        fromAccountId: f.fromAccountId,
        toAccountId: f.toAccountId,
        book,
        billedToCompanyTaxId: billed,
      })
      .returning({ id: transactions.id });

    await storeTransactionDocument(db, orgId, inserted.id, formData, billed);

    await logWeb(orgId, "create", "transaction", inserted.id, str(formData.get("description")) ?? type);

    revalidatePath("/transactions");
    revalidatePath("/accountant-notices");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateParty(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id) return { ok: false, error: "缺少 ID" };
  if (!name) return { ok: false, error: "請輸入名稱" };

  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(parties)
      .set({
        name,
        label: str(formData.get("label")) ?? "vendor",
        taxId: str(formData.get("taxId")),
        defaultCurrency: str(formData.get("defaultCurrency")),
        defaultAccountId: num(formData.get("defaultAccountId")),
        typicalAmount: str(formData.get("typicalAmount")),
        contact: str(formData.get("contact")),
        note: str(formData.get("note")),
        isActive: formData.get("isActive") === "on",
      })
      .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)));
    await logWeb(orgId, "update", "party", id, name);
    revalidatePath("/parties");
    revalidatePath(`/parties/${id}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "更新失敗";
    return {
      ok: false,
      error: msg.includes("parties_name_key") ? "已有相同名稱的交易對象" : msg,
    };
  }
}

// 記錄撥款：把某筆代墊（type=advance）結掉 → 建一筆 type=reimbursement、related_to=該代墊
export async function createReimbursement(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const advanceId = num(formData.get("advanceId"));
  const fromAccountId = num(formData.get("fromAccountId"));
  const payDate = str(formData.get("payDate"));
  const amount = str(formData.get("amount"));

  if (!advanceId) return { ok: false, error: "缺少代墊紀錄" };
  if (!fromAccountId) return { ok: false, error: "請選擇付款帳戶" };
  if (!payDate) return { ok: false, error: "請選擇撥款日期" };
  if (amount === null) return { ok: false, error: "請輸入金額" };

  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    // 讀原代墊，拿到代墊人（員工）＝撥款對象
    const [adv] = await db
      .select({
        settleEmployeeId: transactions.settleEmployeeId,
        currency: transactions.currency,
      })
      .from(transactions)
      .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, advanceId)))
      .limit(1);
    if (!adv) return { ok: false, error: "找不到該代墊紀錄" };
    const advCurrency = adv.currency ?? "TWD";

    const [inserted] = await db
      .insert(transactions)
      .values({
        organizationId: orgId,
        type: "reimbursement",
        txnDate: payDate,
        settleEmployeeId: adv.settleEmployeeId, // 付給代墊人（員工）
        amount,
        currency: advCurrency,
        amountTwd: advCurrency === "TWD" ? amount : null,
        fromAccountId,
        book: "internal",
        relatedToId: advanceId,
        description: "撥款還代墊",
      })
      .returning({ id: transactions.id });

    await logWeb(orgId, "create", "transaction", inserted.id, "員工代墊撥款");

    revalidatePath("/advances");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "撥款失敗" };
  }
}

// ---- 分類（科目）----
const CATEGORY_KINDS = new Set(["income", "cogs", "expense"]);

export async function createCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = str(formData.get("name"));
  const kind = str(formData.get("kind")) ?? "expense";
  if (!name) return { ok: false, error: "請輸入分類名稱" };
  if (!CATEGORY_KINDS.has(kind)) return { ok: false, error: "分類別不正確" };
  try {
    const { orgId } = await requireOrg();
    const [inserted] = await getDb()
      .insert(categories)
      .values({ organizationId: orgId, name, kind })
      .returning({ id: categories.id });
    await logWeb(orgId, "create", "category", inserted.id, name);
    revalidatePath("/categories");
    revalidatePath("/transactions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id) return { ok: false, error: "缺少 ID" };
  if (!name) return { ok: false, error: "請輸入分類名稱" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(categories)
      .set({ name })
      .where(and(eq(categories.organizationId, orgId), eq(categories.id, id)));
    await logWeb(orgId, "update", "category", id, name);
    revalidatePath("/categories");
    revalidatePath("/transactions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteCategory(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(categories)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(categories.organizationId, orgId), eq(categories.id, id)));
    await logWeb(orgId, "delete", "category", id);
    revalidatePath("/categories");
    revalidatePath("/transactions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 銀行帳戶 ----
export async function createBankAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "請輸入名稱" };
  try {
    const { orgId } = await requireOrg();
    const [inserted] = await getDb()
      .insert(bankAccounts)
      .values({
        organizationId: orgId,
        name,
        kind: str(formData.get("kind")) ?? "bank",
        currency: str(formData.get("currency")) ?? "TWD",
        openingBalance: str(formData.get("openingBalance")) ?? "0",
        isActive: true,
      })
      .returning({ id: bankAccounts.id });
    await logWeb(orgId, "create", "bank_account", inserted.id, name);
    revalidatePath("/bank-accounts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateBankAccount(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id) return { ok: false, error: "缺少 ID" };
  if (!name) return { ok: false, error: "請輸入名稱" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(bankAccounts)
      .set({
        name,
        kind: str(formData.get("kind")) ?? "bank",
        currency: str(formData.get("currency")) ?? "TWD",
        openingBalance: str(formData.get("openingBalance")) ?? "0",
        isActive: formData.get("isActive") === "on",
      })
      .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, id)));
    await logWeb(orgId, "update", "bank_account", id, name);
    revalidatePath("/bank-accounts");
    revalidatePath(`/bank-accounts/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteBankAccount(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(bankAccounts)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, id)));
    await logWeb(orgId, "delete", "bank_account", id);
    revalidatePath("/bank-accounts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 員工 ----

/**
 * 員工表單的 user 綁定值 → user_id。空值/未選 = 不綁定（NULL）。
 * 綁定前檢查：該 user 是本組織成員、且尚未綁到其他員工（不強制 1:1，但不能一人綁多筆）。
 */
async function resolveEmployeeUserId(
  orgId: string,
  raw: string | null,
  excludeEmployeeId?: number,
): Promise<string | null> {
  if (!raw || raw === "none") return null;
  const db = getDb();
  const [m] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, raw)))
    .limit(1);
  if (!m) throw new Error("該使用者不是此組織成員");
  const [taken] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.userId, raw), isNull(employees.deletedAt)))
    .limit(1);
  if (taken && taken.id !== excludeEmployeeId) {
    throw new Error("此使用者已綁定其他員工");
  }
  return raw;
}

/** 員工表單的 email 欄位檢查：空值放行，有填就要是合法格式。 */
function employeeEmailError(formData: FormData): string | null {
  const work = str(formData.get("workEmail"));
  const personal = str(formData.get("personalEmail"));
  if (work && !isValidEmail(work)) return "工作 Email 格式不正確";
  if (personal && !isValidEmail(personal)) return "聯絡 Email 格式不正確";
  return null;
}

export async function createEmployee(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "請輸入姓名" };
  const emailErr = employeeEmailError(formData);
  if (emailErr) return { ok: false, error: emailErr };
  const laborInsured = str(formData.get("laborInsuredSalary"));
  const healthInsured = str(formData.get("healthInsuredSalary"));
  try {
    const { orgId } = await requireOrg();
    const userId = await resolveEmployeeUserId(orgId, str(formData.get("userId")));
    const [inserted] = await getDb()
      .insert(employees)
      .values({
        organizationId: orgId,
        name,
        nationalId: str(formData.get("nationalId")),
        employmentType: str(formData.get("employmentType")) ?? "full_time",
        hasLaborInsurance: laborInsured !== null,
        hasHealthInsurance: healthInsured !== null,
        hasPension: formData.get("hasPension") === "on",
        baseSalary: str(formData.get("baseSalary")),
        laborInsuredSalary: laborInsured,
        healthInsuredSalary: healthInsured,
        salaryAccount: str(formData.get("salaryAccount")),
        startDate: str(formData.get("startDate")),
        endDate: str(formData.get("endDate")),
        workEmail: str(formData.get("workEmail")),
        personalEmail: str(formData.get("personalEmail")),
        phone: str(formData.get("phone")),
        note: str(formData.get("note")),
        userId,
        isActive: true,
      })
      .returning({ id: employees.id });
    await logWeb(orgId, "create", "employee", inserted.id, name);
    revalidatePath("/employees");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateEmployee(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id) return { ok: false, error: "缺少 ID" };
  if (!name) return { ok: false, error: "請輸入姓名" };
  const emailErr = employeeEmailError(formData);
  if (emailErr) return { ok: false, error: emailErr };
  const laborInsured = str(formData.get("laborInsuredSalary"));
  const healthInsured = str(formData.get("healthInsuredSalary"));
  try {
    const { orgId } = await requireOrg();
    const userId = await resolveEmployeeUserId(orgId, str(formData.get("userId")), id);
    await getDb()
      .update(employees)
      .set({
        name,
        nationalId: str(formData.get("nationalId")),
        employmentType: str(formData.get("employmentType")) ?? "full_time",
        hasLaborInsurance: laborInsured !== null,
        hasHealthInsurance: healthInsured !== null,
        hasPension: formData.get("hasPension") === "on",
        baseSalary: str(formData.get("baseSalary")),
        laborInsuredSalary: laborInsured,
        healthInsuredSalary: healthInsured,
        salaryAccount: str(formData.get("salaryAccount")),
        startDate: str(formData.get("startDate")),
        endDate: str(formData.get("endDate")),
        workEmail: str(formData.get("workEmail")),
        personalEmail: str(formData.get("personalEmail")),
        phone: str(formData.get("phone")),
        note: str(formData.get("note")),
        userId,
        isActive: formData.get("isActive") === "on",
      })
      .where(and(eq(employees.organizationId, orgId), eq(employees.id, id)));
    await logWeb(orgId, "update", "employee", id, name);
    revalidatePath("/employees");
    revalidatePath(`/employees/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteEmployee(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(employees)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(employees.organizationId, orgId), eq(employees.id, id)));
    await logWeb(orgId, "delete", "employee", id);
    revalidatePath("/employees");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 交易對象 / 交易 刪除 ----
export async function deleteParty(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(parties)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)));
    await logWeb(orgId, "delete", "party", id);
    revalidatePath("/parties");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

export async function deleteTransaction(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    // 確認這筆交易屬於目前 org，否則不准刪
    const [owned] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
      .limit(1);
    if (!owned) return { ok: false, error: "找不到該交易" };
    // 薪資發放產生的交易：要刪請到「薪資」頁撤銷該筆發放（會連這筆交易一起刪）
    const [slip] = await db
      .select({ id: payslips.id })
      .from(payslips)
      .where(eq(payslips.paidTransactionId, id))
      .limit(1);
    if (slip) {
      return {
        ok: false,
        error: "這筆是發薪產生的交易，不能直接刪；請到「薪資」頁撤銷該筆發放。",
      };
    }
    // 軟刪除這筆交易的憑證（保留 R2 檔，不移除 storage）
    await db
      .update(documents)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(documents.transactionId, id));
    await db
      .update(transactions)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)));
    await logWeb(orgId, "delete", "transaction", id);
    revalidatePath("/transactions");
    revalidatePath("/advances");
    revalidatePath("/accountant-notices");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// 軟刪除交易的某筆憑證（保留 R2 檔，不移除 storage）
export async function deleteTransactionDocument(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const [doc] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)))
      .limit(1);
    if (!doc) return { ok: false, error: "找不到該憑證" };
    await db
      .update(documents)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)));
    await logWeb(orgId, "delete", "document", id);
    revalidatePath("/transactions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// 標記 / 取消標記「已通知會計師」（針對其他發票憑證）
export async function markAccountantNotified(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(documents)
      .set({ accountantNotifiedAt: new Date().toISOString() })
      .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)));
    revalidatePath("/accountant-notices");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function unmarkAccountantNotified(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(documents)
      .set({ accountantNotifiedAt: null })
      .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)));
    revalidatePath("/accountant-notices");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

// 編輯交易：類型不可改，其餘（日期/金額/幣別/對象/帳戶/分類/摘要/報稅/統編/憑證）比照新增
export async function updateTransaction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  const type = str(formData.get("type"));
  const txnDate = str(formData.get("txnDate"));
  const amount = str(formData.get("amount"));
  const currency = str(formData.get("currency")) ?? "TWD";
  if (!id) return { ok: false, error: "缺少 ID" };
  if (!type) return { ok: false, error: "缺少交易類型" };
  if (!txnDate) return { ok: false, error: "請選擇日期" };
  if (amount === null) return { ok: false, error: "請輸入金額" };

  const reported = type === "transfer" || formData.get("reported") === "on";
  const book = reported ? "both" : "internal";
  const billed = formData.get("billedToCompanyTaxId") === "on";
  if (billed) {
    const kind = str(formData.get("docKind"));
    if (kind !== "e_invoice" && kind !== "paper_invoice") {
      return { ok: false, error: "有報公司統編時，憑證類型必須是電子發票或其他發票" };
    }
  }

  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const resolved = await resolveTxnFields(db, orgId, type, formData);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const f = resolved.fields;

    await db
      .update(transactions)
      .set({
        txnDate,
        amount,
        currency,
        amountTwd: currency === "TWD" ? amount : null,
        description: str(formData.get("description")),
        categoryId: f.categoryId,
        partyId: f.partyId,
        settleEmployeeId: f.settleEmployeeId,
        projectId: num(formData.get("projectId")),
        contractId: num(formData.get("contractId")),
        subscriptionId: num(formData.get("subscriptionId")),
        subscriptionPeriod: str(formData.get("subscriptionPeriod")),
        fromAccountId: f.fromAccountId,
        toAccountId: f.toAccountId,
        book,
        billedToCompanyTaxId: billed,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)));
    // 編輯時若有補上憑證，新增一筆 documents
    await storeTransactionDocument(db, orgId, id, formData, billed);
    await logWeb(orgId, "update", "transaction", id);
    revalidatePath("/transactions");
    revalidatePath("/accountant-notices");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

// ---- 發票 ----
const INVOICE_EXTERNAL_STATUS = new Set(["pending", "issued", "void", "n_a"]);

/**
 * Simpany 端的開立狀態（migrations/0019）。
 *
 * 表單有明確選就聽表單的；沒選就推導 —— 進項發票不經 Simpany（n_a）、
 * 有號碼代表已經開出來了（issued）、沒號碼就是本系統認為該開但還沒開（pending）。
 */
function resolveExternalStatus(
  raw: string | null,
  direction: string,
  externalRef: string | null,
): string {
  // 進項發票不經 Simpany，表單選了什麼都不算數。
  if (direction === "received") return "n_a";
  if (raw && INVOICE_EXTERNAL_STATUS.has(raw)) return raw;
  return externalRef ? "issued" : "pending";
}

function invoiceValues(formData: FormData) {
  const direction = str(formData.get("direction")) ?? "received";
  // Simpany 的單號就是發票號碼，兩個欄位共用一個輸入框（任一有值即補齊另一個）。
  const externalRef = str(formData.get("externalRef")) ?? str(formData.get("invoiceNumber"));
  return {
    direction,
    invoiceNumber: str(formData.get("invoiceNumber")) ?? externalRef,
    externalRef,
    externalStatus: resolveExternalStatus(
      str(formData.get("externalStatus")),
      direction,
      externalRef,
    ),
    invoiceDate: str(formData.get("invoiceDate")),
    counterpartyName: str(formData.get("counterpartyName")),
    counterpartyTaxId: str(formData.get("counterpartyTaxId")),
    amountNet: str(formData.get("amountNet")),
    tax: str(formData.get("tax")),
    amountGross: str(formData.get("amountGross")),
    currency: str(formData.get("currency")) ?? "TWD",
    status: str(formData.get("status")) ?? "valid",
    note: str(formData.get("note")),
    // 對象／來源綁定（migrations/0017）：讓「這張發票是哪個客戶、對應哪一筆請款」有答案。
    // 對象收名稱（查無就在存檔時新建），與合約／訂閱／請款項目一致。
    partyName: str(formData.get("partyName")),
    contractId: num(formData.get("contractId")),
    billingItemId: num(formData.get("billingItemId")),
  };
}

/** 把表單值裡的 partyName 換成 partyId（查無就新建）。銷項對象是客戶、進項是廠商。 */
async function invoiceColumns(orgId: string, formData: FormData) {
  const { partyName, ...columns } = invoiceValues(formData);
  const party = await resolvePartyName(
    getDb(),
    orgId,
    partyName,
    columns.direction === "received" ? "vendor" : "customer",
  );
  return { columns: { ...columns, partyId: party.id }, created: party.created };
}

export async function createInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    const { columns: v, created } = await invoiceColumns(orgId, formData);
    const [inserted] = await getDb()
      .insert(invoices)
      .values({ organizationId: orgId, ...v })
      .returning({ id: invoices.id });
    await logWeb(orgId, "create", "invoice", inserted.id);
    if (created) revalidatePath("/parties");
    // 綁到請款項目時順手回填開發票日，看板的「待開發票」才會自己消掉，
    // 不必再手動標記一次。已經有日期就不覆蓋。
    if (v.billingItemId && v.invoiceDate) {
      await getDb()
        .update(billingItems)
        .set({ invoicedOn: v.invoiceDate })
        .where(
          and(
            eq(billingItems.organizationId, orgId),
            eq(billingItems.id, v.billingItemId),
            isNull(billingItems.invoicedOn),
          ),
        );
      revalidatePath("/billing");
    }
    revalidatePath("/invoices");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  if (!id) return { ok: false, error: "缺少 ID" };
  try {
    const { orgId } = await requireOrg();
    const { columns, created } = await invoiceColumns(orgId, formData);
    await getDb()
      .update(invoices)
      .set(columns)
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, id)));
    await logWeb(orgId, "update", "invoice", id);
    if (created) revalidatePath("/parties");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteInvoice(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(invoices)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, id)));
    await logWeb(orgId, "delete", "invoice", id);
    revalidatePath("/invoices");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

/**
 * 對帳頁的就地更新：把 Simpany 的實際狀態與單號寫回這張發票。
 *
 * 發票號碼與 Simpany 單號在台灣是同一個東西，所以兩個欄位一起寫，
 * 之後不管從哪邊比對都對得起來。
 */
export async function markInvoiceExternal(
  id: number,
  externalStatus: string,
  externalRef: string | null,
): Promise<ActionState> {
  if (!INVOICE_EXTERNAL_STATUS.has(externalStatus)) {
    return { ok: false, error: "狀態不正確" };
  }
  try {
    const { orgId } = await requireOrg();
    const ref = externalRef?.trim() ? externalRef.trim() : null;
    await getDb()
      .update(invoices)
      .set({
        externalStatus,
        externalRef: ref,
        // 已開立才回填發票號碼；還沒開／作廢時不動既有號碼。
        ...(externalStatus === "issued" && ref ? { invoiceNumber: ref } : {}),
      })
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, id)));
    await logWeb(orgId, "update", "invoice", id, `Simpany ${externalStatus}`);
    revalidatePath("/invoices");
    revalidatePath("/invoices/reconcile");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

// ---- 對帳 ----
export async function updateReconciliation(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  const accountId = num(formData.get("accountId"));
  const asOfDate = str(formData.get("asOfDate"));
  const statementBalance = str(formData.get("statementBalance"));
  if (!id) return { ok: false, error: "缺少 ID" };
  if (!accountId) return { ok: false, error: "請選擇帳戶" };
  if (!asOfDate) return { ok: false, error: "請選擇截止日期" };
  if (statementBalance === null) return { ok: false, error: "請輸入對帳單餘額" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(accountReconciliations)
      .set({ accountId, asOfDate, statementBalance, note: str(formData.get("note")) })
      .where(and(eq(accountReconciliations.organizationId, orgId), eq(accountReconciliations.id, id)));
    await logWeb(orgId, "update", "reconciliation", id);
    revalidatePath("/reconciliation");
    revalidatePath(`/reconciliation/${id}`);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "更新失敗";
    return {
      ok: false,
      error: msg.includes("uq_recon_account_date") ? "此帳戶在該日期已有對帳紀錄" : msg,
    };
  }
}

export async function deleteReconciliation(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(accountReconciliations)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(accountReconciliations.organizationId, orgId), eq(accountReconciliations.id, id)));
    await logWeb(orgId, "delete", "reconciliation", id);
    revalidatePath("/reconciliation");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 薪資（軟刪除整期；payslips 隨之軟刪除）----
export async function deletePayrollRun(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const deletedAt = new Date().toISOString();
    await db
      .update(payslips)
      .set({ deletedAt })
      .where(eq(payslips.payrollRunId, id));
    await db
      .update(payrollRuns)
      .set({ deletedAt })
      .where(and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.id, id)));
    await logWeb(orgId, "delete", "payroll_run", id);
    revalidatePath("/payroll");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

type PayItem = {
  itemTypeId: number | null;
  name: string;
  direction: string;
  isTaxable: boolean;
  amount: number;
};

function sumPayItems(items: PayItem[]) {
  let taxable = 0;
  let nontaxable = 0;
  let otherDeduction = 0;
  for (const r of items) {
    if (r.direction === "deduction") otherDeduction += r.amount;
    else if (r.isTaxable) taxable += r.amount;
    else nontaxable += r.amount;
  }
  return { taxable, nontaxable, otherDeduction };
}

async function getOrCreatePayrollRunId(
  db: ReturnType<typeof getDb>,
  orgId: string,
  year: number,
  month: number,
  payDate: string,
): Promise<number> {
  const [run] = await db
    .select({ id: payrollRuns.id })
    .from(payrollRuns)
    .where(
      and(
        eq(payrollRuns.organizationId, orgId),
        eq(payrollRuns.periodYear, year),
        eq(payrollRuns.periodMonth, month),
      ),
    )
    .limit(1);
  if (run) return run.id;
  const [created] = await db
    .insert(payrollRuns)
    .values({ organizationId: orgId, periodYear: year, periodMonth: month, payDate, status: "paid" })
    .returning({ id: payrollRuns.id });
  return created.id;
}

// 直接幫某位員工發放薪資（從員工頁觸發）：
// - 自動歸到該年月的薪資批次（沒有就建）
// - 寫一張薪資單（含底薪/加減項 + 勞健保自付）、快照勞健保
// - 建一筆薪資支出交易並回寫 paid_transaction_id
export async function payEmployeeSalary(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const employeeId = num(formData.get("employeeId"));
  const year = num(formData.get("periodYear"));
  const month = num(formData.get("periodMonth"));
  const payDate = str(formData.get("payDate"));
  const fromAccountId = num(formData.get("fromAccountId"));
  if (!employeeId) return { ok: false, error: "缺少員工" };
  if (!year || !month) return { ok: false, error: "請選擇發薪月份" };
  if (!payDate) return { ok: false, error: "請選擇發薪日" };
  if (!fromAccountId) return { ok: false, error: "請選擇付款帳戶" };
  // 帳別：沒投保沒合約的可只記內帳、不報稅
  const bookRaw = str(formData.get("book")) ?? "both";
  const book = ["internal", "external", "both"].includes(bookRaw) ? bookRaw : "both";

  // 薪資項目（底薪、加班費、獎金、請假扣…）
  let items: PayItem[] = [];
  try {
    items = JSON.parse(str(formData.get("items")) ?? "[]") as PayItem[];
  } catch {
    return { ok: false, error: "明細格式錯誤" };
  }
  items = items.filter((r) => r?.name && Number.isFinite(r.amount) && r.amount !== 0);

  const { taxable, nontaxable, otherDeduction } = sumPayItems(items);
  if (taxable + nontaxable <= 0) return { ok: false, error: "請至少填一項薪資（如底薪）" };

  const deductionTotal = otherDeduction;
  const net = taxable + nontaxable - deductionTotal;

  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const runId = await getOrCreatePayrollRunId(db, orgId, year, month, payDate);

    // 一個員工一個月一張：已發放就擋
    const [existing] = await db
      .select({ id: payslips.id, paidTransactionId: payslips.paidTransactionId })
      .from(payslips)
      .where(and(eq(payslips.payrollRunId, runId), eq(payslips.employeeId, employeeId)))
      .limit(1);
    if (existing?.paidTransactionId)
      return { ok: false, error: "這位員工本月已發放過了" };

    // 薪資支出交易（每人一筆）
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.organizationId, orgId), eq(categories.name, "薪資費用")))
      .limit(1);
    const [emp] = await db
      .select({ name: employees.name })
      .from(employees)
      .where(and(eq(employees.organizationId, orgId), eq(employees.id, employeeId)))
      .limit(1);
    const period = `${year}-${String(month).padStart(2, "0")}`;
    const [txn] = await db
      .insert(transactions)
      .values({
        organizationId: orgId,
        type: "expense",
        txnDate: payDate,
        description: `${period} 薪資 - ${emp?.name ?? ""}`.trim(),
        categoryId: cat?.id ?? null,
        settleEmployeeId: employeeId,
        amount: String(net),
        currency: "TWD",
        amountTwd: String(net),
        fromAccountId,
        book,
        billedToCompanyTaxId: false,
      })
      .returning({ id: transactions.id });

    const slipValues = {
      taxableTotal: String(taxable),
      nontaxableTotal: String(nontaxable),
      deductionTotal: String(deductionTotal),
      netPay: String(net),
      paidTransactionId: txn.id,
    };

    let payslipId: number;
    if (existing) {
      payslipId = existing.id;
      await db.update(payslips).set(slipValues).where(eq(payslips.id, payslipId));
      await db.delete(payslipItems).where(eq(payslipItems.payslipId, payslipId));
    } else {
      const [ins] = await db
        .insert(payslips)
        .values({ payrollRunId: runId, employeeId, ...slipValues })
        .returning({ id: payslips.id });
      payslipId = ins.id;
    }

    // 明細
    const allItems = items.map((r) => ({
      payslipId,
      itemTypeId: r.itemTypeId,
      name: r.name,
      direction: r.direction === "deduction" ? "deduction" : "earning",
      isTaxable: r.direction === "deduction" ? false : !!r.isTaxable,
      amount: String(r.amount),
      hours: null,
    }));
    if (allItems.length > 0) await db.insert(payslipItems).values(allItems);

    await logWeb(orgId, "create", "transaction", txn.id, "發放薪資");

    revalidatePath("/payroll");
    revalidatePath("/employees");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "發放失敗" };
  }
}

// 刪除（撤銷）一張薪資單，連同它產生的薪資支出交易
export async function deletePayslip(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const [slip] = await db
      .select({ paidTransactionId: payslips.paidTransactionId })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payslips.payrollRunId, payrollRuns.id))
      .where(and(eq(payrollRuns.organizationId, orgId), eq(payslips.id, id)))
      .limit(1);
    if (!slip) return { ok: false, error: "找不到該薪資單" };
    const deletedAt = new Date().toISOString();
    await db.update(payslips).set({ deletedAt }).where(eq(payslips.id, id));
    if (slip?.paidTransactionId) {
      await db
        .update(transactions)
        .set({ deletedAt })
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, slip.paidTransactionId)));
    }
    await logWeb(orgId, "delete", "payslip", id);
    revalidatePath("/payroll");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 專案 ----
const PROJECT_STATUS = new Set(["active", "archived"]);

export async function createProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "請輸入專案名稱" };
  const status = str(formData.get("status")) ?? "active";
  if (!PROJECT_STATUS.has(status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const client = await resolvePartyName(db, orgId, str(formData.get("clientPartyName")));
    const [inserted] = await db
      .insert(projects)
      .values({
        organizationId: orgId,
        name,
        clientPartyId: client.id,
        status,
        description: str(formData.get("description")),
      })
      .returning({ id: projects.id });
    await logWeb(orgId, "create", "project", inserted.id, name);
    revalidatePath("/projects");
    if (client.created) revalidatePath("/parties");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateProject(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id) return { ok: false, error: "缺少 ID" };
  if (!name) return { ok: false, error: "請輸入專案名稱" };
  const status = str(formData.get("status")) ?? "active";
  if (!PROJECT_STATUS.has(status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const client = await resolvePartyName(db, orgId, str(formData.get("clientPartyName")));
    await db
      .update(projects)
      .set({
        name,
        clientPartyId: client.id,
        status,
        description: str(formData.get("description")),
      })
      .where(and(eq(projects.organizationId, orgId), eq(projects.id, id)));
    await logWeb(orgId, "update", "project", id, name);
    revalidatePath("/projects");
    if (client.created) revalidatePath("/parties");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteProject(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(projects)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(projects.organizationId, orgId), eq(projects.id, id)));
    await logWeb(orgId, "delete", "project", id);
    revalidatePath("/projects");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 訂閱 / 月費 ----
const SUBSCRIPTION_STATUS = new Set(["active", "paused", "ended"]);

function subscriptionValues(formData: FormData) {
  return {
    customerPartyName: str(formData.get("customerPartyName")),
    projectId: num(formData.get("projectId")),
    name: str(formData.get("name")),
    amount: str(formData.get("amount")),
    currency: str(formData.get("currency")) ?? "TWD",
    intervalMonths: num(formData.get("intervalMonths")) ?? 1,
    startDate: str(formData.get("startDate")),
    endDate: str(formData.get("endDate")),
    status: str(formData.get("status")) ?? "active",
    note: str(formData.get("note")),
  };
}

export async function createSubscription(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const v = subscriptionValues(formData);
  if (!v.name) return { ok: false, error: "請輸入方案名稱" };
  if (v.amount === null) return { ok: false, error: "請輸入金額" };
  if (!v.startDate) return { ok: false, error: "請選擇開始日期" };
  if (!SUBSCRIPTION_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const customer = await requireCustomer(db, orgId, v.customerPartyName);
    if ("error" in customer) return { ok: false, error: customer.error };
    const [inserted] = await db
      .insert(subscriptions)
      .values({
        organizationId: orgId,
        customerPartyId: customer.id,
        projectId: v.projectId,
        name: v.name,
        amount: v.amount,
        currency: v.currency,
        intervalMonths: v.intervalMonths,
        startDate: v.startDate,
        endDate: v.endDate,
        status: v.status,
        note: v.note,
      })
      .returning({ id: subscriptions.id });
    await logWeb(orgId, "create", "subscription", inserted.id, v.name ?? undefined);
    revalidatePath("/subscriptions");
    if (customer.created) revalidatePath("/parties");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateSubscription(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  if (!id) return { ok: false, error: "缺少 ID" };
  const v = subscriptionValues(formData);
  if (!v.name) return { ok: false, error: "請輸入方案名稱" };
  if (v.amount === null) return { ok: false, error: "請輸入金額" };
  if (!v.startDate) return { ok: false, error: "請選擇開始日期" };
  if (!SUBSCRIPTION_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const customer = await requireCustomer(db, orgId, v.customerPartyName);
    if ("error" in customer) return { ok: false, error: customer.error };
    await db
      .update(subscriptions)
      .set({
        customerPartyId: customer.id,
        projectId: v.projectId,
        name: v.name,
        amount: v.amount,
        currency: v.currency,
        intervalMonths: v.intervalMonths,
        startDate: v.startDate,
        endDate: v.endDate,
        status: v.status,
        note: v.note,
      })
      .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.id, id)));
    await logWeb(orgId, "update", "subscription", id, v.name ?? undefined);
    revalidatePath("/subscriptions");
    if (customer.created) revalidatePath("/parties");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteSubscription(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(subscriptions)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.id, id)));
    await logWeb(orgId, "delete", "subscription", id);
    revalidatePath("/subscriptions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 合約 ----
const CONTRACT_STATUS = new Set(["draft", "active", "completed", "cancelled"]);
const CONTRACT_BILLING_PLAN = new Set(["single", "installments", "milestones", "subscription"]);
const CONTRACT_DUE_RULE = new Set(["signed_date", "day_of_month", "business_day_of_month"]);

/** 夾在合法區間內；超出範圍的值退回預設，不擋存檔。 */
function clampInt(v: number | null, min: number, max: number, fallback: number | null) {
  if (v == null || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function contractValues(formData: FormData) {
  const billingPlan = str(formData.get("billingPlan"));
  const dueRule = str(formData.get("dueRule"));
  return {
    customerPartyName: str(formData.get("customerPartyName")),
    projectId: num(formData.get("projectId")),
    title: str(formData.get("title")),
    amount: str(formData.get("amount")),
    currency: str(formData.get("currency")) ?? "TWD",
    startDate: str(formData.get("startDate")),
    endDate: str(formData.get("endDate")),
    signedDate: str(formData.get("signedDate")),
    paymentTermsDays: num(formData.get("paymentTermsDays")),
    status: str(formData.get("status")) ?? "active",
    note: str(formData.get("note")),
    fileUrl: str(formData.get("fileUrl")),
    // 請款計畫（migrations/0019）。不合法的值一律當成「未設定」——
    // 計畫只是產生排程的參數，不值得為了它擋掉整張合約的存檔。
    billingPlan: billingPlan && CONTRACT_BILLING_PLAN.has(billingPlan) ? billingPlan : null,
    installmentCount: clampInt(num(formData.get("installmentCount")), 1, 60, null),
    installmentSplit: str(formData.get("installmentSplit")),
    billingIntervalMonths: clampInt(num(formData.get("billingIntervalMonths")), 1, 12, 1) ?? 1,
    dueRule: dueRule && CONTRACT_DUE_RULE.has(dueRule) ? dueRule : "signed_date",
    dueDay: clampInt(num(formData.get("dueDay")), 1, 31, null),
    regenerateSchedule: formData.get("regenerateSchedule") != null,
  };
}

type ContractValues = ReturnType<typeof contractValues>;

/** 把合約表單的值轉成排程引擎吃的輸入。 */
function scheduleInputOf(v: ContractValues): ScheduleInput {
  return {
    billingPlan: v.billingPlan as BillingPlan | null,
    amount: v.amount == null ? null : Number(v.amount),
    installmentCount: v.installmentCount,
    installmentSplit: v.installmentSplit,
    intervalMonths: v.billingIntervalMonths,
    dueRule: v.dueRule as DueRule,
    dueDay: v.dueDay,
    signedDate: v.signedDate,
    startDate: v.startDate,
  };
}

/**
 * 依請款計畫展開 billing_items。
 *
 * 兩個時機會展開：新合約設了計畫、或既有合約還沒有任何排程時第一次設計畫。
 * 已經有排程的合約要重排，必須明確勾「重新產生」（regenerate = true）——
 * 而且已請款 / 已開票 / 已收款的期別絕不刪除，只重排沒動過的那些，並把已鎖定
 * 期別的金額從總額裡扣掉，避免重排出來的總和超過合約金額。
 */
async function expandContractSchedule(
  db: ReturnType<typeof getDb>,
  orgId: string,
  contractId: number,
  customerPartyId: number,
  v: ContractValues,
  regenerate: boolean,
): Promise<number> {
  const existing = await db
    .select({
      id: billingItems.id,
      amount: billingItems.amount,
      billedOn: billingItems.billedOn,
      paidOn: billingItems.paidOn,
      invoicedOn: billingItems.invoicedOn,
    })
    .from(billingItems)
    .where(
      and(
        eq(billingItems.organizationId, orgId),
        eq(billingItems.contractId, contractId),
        isNull(billingItems.deletedAt),
      ),
    );

  if (existing.length > 0 && !regenerate) return 0;

  const paidById = await billingItemPaidById(orgId);
  const locked = existing.filter(
    (r) =>
      r.billedOn != null ||
      r.paidOn != null ||
      r.invoicedOn != null ||
      (paidById.get(r.id) ?? 0) > 0,
  );
  const removable = existing.filter((r) => !locked.some((l) => l.id === r.id));

  // 鎖定的期別已經佔掉一部分合約金額，剩下的才拿去重排。
  const lockedTotal = locked.reduce((sum, r) => sum + Number(r.amount), 0);
  const total = v.amount == null ? null : Number(v.amount) - lockedTotal;
  const rows = generateSchedule({ ...scheduleInputOf(v), amount: total });
  if (rows.length === 0) return 0;

  if (removable.length > 0) {
    await db
      .update(billingItems)
      .set({ deletedAt: new Date().toISOString() })
      .where(
        and(
          eq(billingItems.organizationId, orgId),
          inArray(
            billingItems.id,
            removable.map((r) => r.id),
          ),
        ),
      );
  }

  await db.insert(billingItems).values(
    rows.map((r) => ({
      organizationId: orgId,
      customerPartyId,
      contractId,
      projectId: v.projectId,
      title: r.title,
      amount: String(r.amount),
      currency: v.currency,
      dueDate: r.dueDate,
    })),
  );
  return rows.length;
}

export async function createContract(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const v = contractValues(formData);
  if (!v.title) return { ok: false, error: "請輸入合約名稱" };
  if (!CONTRACT_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const customer = await requireCustomer(db, orgId, v.customerPartyName);
    if ("error" in customer) return { ok: false, error: customer.error };
    const [inserted] = await db
      .insert(contracts)
      .values({
        organizationId: orgId,
        customerPartyId: customer.id,
        projectId: v.projectId,
        title: v.title,
        amount: v.amount,
        currency: v.currency,
        startDate: v.startDate,
        endDate: v.endDate,
        signedDate: v.signedDate,
        paymentTermsDays: v.paymentTermsDays,
        status: v.status,
        note: v.note,
        fileUrl: v.fileUrl,
        billingPlan: v.billingPlan,
        installmentCount: v.installmentCount,
        installmentSplit: v.installmentSplit,
        billingIntervalMonths: v.billingIntervalMonths,
        dueRule: v.dueRule,
        dueDay: v.dueDay,
      })
      .returning({ id: contracts.id });
    await logWeb(orgId, "create", "contract", inserted.id, v.title ?? undefined);
    // 新合約一定沒有既有排程，直接展開（展不出來就是 0 期，不是錯誤）。
    const created = await expandContractSchedule(db, orgId, inserted.id, customer.id, v, false);
    revalidatePath("/contracts");
    if (customer.created) revalidatePath("/parties");
    if (created > 0) {
      revalidatePath("/billing");
      await syncCalendarBestEffort(orgId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateContract(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  if (!id) return { ok: false, error: "缺少 ID" };
  const v = contractValues(formData);
  if (!v.title) return { ok: false, error: "請輸入合約名稱" };
  if (!CONTRACT_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const customer = await requireCustomer(db, orgId, v.customerPartyName);
    if ("error" in customer) return { ok: false, error: customer.error };
    await db
      .update(contracts)
      .set({
        customerPartyId: customer.id,
        projectId: v.projectId,
        title: v.title,
        amount: v.amount,
        currency: v.currency,
        startDate: v.startDate,
        endDate: v.endDate,
        signedDate: v.signedDate,
        paymentTermsDays: v.paymentTermsDays,
        status: v.status,
        note: v.note,
        fileUrl: v.fileUrl,
        billingPlan: v.billingPlan,
        installmentCount: v.installmentCount,
        installmentSplit: v.installmentSplit,
        billingIntervalMonths: v.billingIntervalMonths,
        dueRule: v.dueRule,
        dueDay: v.dueDay,
      })
      .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, id)));
    await logWeb(orgId, "update", "contract", id, v.title ?? undefined);
    // 沒有排程時第一次設計畫 → 直接展開；已有排程 → 只有勾了「重新產生」才重排。
    const changed = await expandContractSchedule(
      db,
      orgId,
      id,
      customer.id,
      v,
      v.regenerateSchedule,
    );
    revalidatePath("/contracts");
    if (customer.created) revalidatePath("/parties");
    if (changed > 0) {
      revalidatePath("/billing");
      await syncCalendarBestEffort(orgId);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteContract(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(contracts)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, id)));
    await logWeb(orgId, "delete", "contract", id);
    revalidatePath("/contracts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 請款項目（billing_items，migrations/0017）----

const BILLING_ITEM_STATUS = new Set(["scheduled", "billed", "paid", "cancelled"]);

function billingItemValues(formData: FormData) {
  return {
    customerPartyName: str(formData.get("customerPartyName")),
    contractId: num(formData.get("contractId")),
    projectId: num(formData.get("projectId")),
    title: str(formData.get("title")),
    amount: str(formData.get("amount")),
    currency: str(formData.get("currency")) ?? "TWD",
    dueDate: str(formData.get("dueDate")),
    billedOn: str(formData.get("billedOn")),
    paidOn: str(formData.get("paidOn")),
    invoicedOn: str(formData.get("invoicedOn")),
    needsInvoice: formData.get("needsInvoice") != null,
    status: str(formData.get("status")) ?? "scheduled",
    note: str(formData.get("note")),
  };
}

/** 建立請款項目時，客戶沒指定就沿用合約的客戶（看板一定要有客戶才有意義）。 */
async function resolveBillingCustomer(
  orgId: string,
  customerPartyName: string | null,
  contractId: number | null,
): Promise<{ id: number | null; created: boolean }> {
  const db = getDb();
  if (customerPartyName) return resolvePartyName(db, orgId, customerPartyName);
  if (!contractId) return { id: null, created: false };
  const [c] = await db
    .select({ customerPartyId: contracts.customerPartyId })
    .from(contracts)
    .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, contractId)))
    .limit(1);
  return { id: c?.customerPartyId ?? null, created: false };
}

function revalidateBilling() {
  revalidatePath("/billing");
  revalidatePath("/contracts");
}

/**
 * 請款資料一變動就順手把 Google 日曆推成最新 —— 使用者不必記得按同步。
 *
 * 一律 best-effort：日曆是輔助，Google 掛掉、token 過期或根本沒連結，都不該讓
 * 存檔失敗。同步本身是冪等的，而且內容沒變的事件會被 content_hash 略過，
 * 所以這裡重推整份的成本只有實際變動的那幾顆。
 */
async function syncCalendarBestEffort(orgId: string) {
  try {
    const { syncBillingCalendar } = await import("@/lib/google-calendar");
    const orgs = await auth.api.listOrganizations({ headers: await headers() });
    const name = orgs?.find((o) => o.id === orgId)?.name ?? "組織";
    await syncBillingCalendar(orgId, name);
  } catch {
    // 沒連結日曆 / 授權失效 / Google 暫時不可用 —— 都不影響這筆資料已經存好了。
  }
}

export async function createBillingItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const v = billingItemValues(formData);
  if (!v.title) return { ok: false, error: "請輸入項目名稱" };
  if (!v.amount) return { ok: false, error: "請輸入金額" };
  if (!BILLING_ITEM_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    const customer = await resolveBillingCustomer(orgId, v.customerPartyName, v.contractId);
    if (!customer.id) return { ok: false, error: "請輸入客戶" };
    const [inserted] = await getDb()
      .insert(billingItems)
      .values({
        organizationId: orgId,
        customerPartyId: customer.id,
        contractId: v.contractId,
        projectId: v.projectId,
        title: v.title,
        amount: v.amount,
        currency: v.currency,
        dueDate: v.dueDate,
        billedOn: v.billedOn,
        paidOn: v.paidOn,
        invoicedOn: v.invoicedOn,
        needsInvoice: v.needsInvoice,
        status: v.status,
        note: v.note,
      })
      .returning({ id: billingItems.id });
    await logWeb(orgId, "create", "billing_item", inserted.id, v.title ?? undefined);
    revalidateBilling();
    if (customer.created) revalidatePath("/parties");
    await syncCalendarBestEffort(orgId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateBillingItem(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  if (!id) return { ok: false, error: "缺少 ID" };
  const v = billingItemValues(formData);
  if (!v.title) return { ok: false, error: "請輸入項目名稱" };
  if (!v.amount) return { ok: false, error: "請輸入金額" };
  if (!BILLING_ITEM_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    const customer = await resolveBillingCustomer(orgId, v.customerPartyName, v.contractId);
    if (!customer.id) return { ok: false, error: "請輸入客戶" };
    await getDb()
      .update(billingItems)
      .set({
        customerPartyId: customer.id,
        contractId: v.contractId,
        projectId: v.projectId,
        title: v.title,
        amount: v.amount,
        currency: v.currency,
        dueDate: v.dueDate,
        billedOn: v.billedOn,
        paidOn: v.paidOn,
        invoicedOn: v.invoicedOn,
        needsInvoice: v.needsInvoice,
        status: v.status,
        note: v.note,
      })
      .where(and(eq(billingItems.organizationId, orgId), eq(billingItems.id, id)));
    await logWeb(orgId, "update", "billing_item", id, v.title ?? undefined);
    revalidateBilling();
    if (customer.created) revalidatePath("/parties");
    await syncCalendarBestEffort(orgId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteBillingItem(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(billingItems)
      .set({ deletedAt: new Date().toISOString() })
      .where(and(eq(billingItems.organizationId, orgId), eq(billingItems.id, id)));
    await logWeb(orgId, "delete", "billing_item", id);
    revalidateBilling();
    await syncCalendarBestEffort(orgId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

/**
 * 看板上的快捷動作：把某一列標記為「已請款 / 已收款 / 已開發票」，只寫日期欄位。
 *
 * 兩種來源分開處理：billing_items 直接 update；訂閱期別沒有實體列（期別是算出來的），
 * 所以往 subscription_periods 做 upsert —— 只帶日期、不動 expected_amount，
 * 才不會把「沒有金額覆寫」誤寫成覆寫。
 */
export async function markBillingRow(
  key: string,
  field: "billedOn" | "paidOn" | "invoicedOn",
  date: string | null,
): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    const db = getDb();

    if (key.startsWith("bi:")) {
      const id = Number(key.slice(3));
      if (!Number.isFinite(id)) return { ok: false, error: "項目代號不正確" };
      await db
        .update(billingItems)
        .set({ [field]: date })
        .where(and(eq(billingItems.organizationId, orgId), eq(billingItems.id, id)));
      await logWeb(orgId, "update", "billing_item", id, field);
      revalidateBilling();
      await syncCalendarBestEffort(orgId);
      return { ok: true };
    }

    if (key.startsWith("sub:")) {
      // paid_on 在訂閱端沒有對應欄位（實收一律看綁定的交易），忽略。
      if (field === "paidOn") return { ok: false, error: "訂閱的收款請用交易綁定期別紀錄" };
      const [, rawId, periodStart] = key.split(":");
      const subscriptionId = Number(rawId);
      if (!Number.isFinite(subscriptionId) || !periodStart) {
        return { ok: false, error: "期別代號不正確" };
      }
      const [existing] = await db
        .select({ id: subscriptionPeriods.id })
        .from(subscriptionPeriods)
        .where(
          and(
            eq(subscriptionPeriods.organizationId, orgId),
            eq(subscriptionPeriods.subscriptionId, subscriptionId),
            eq(subscriptionPeriods.periodStart, periodStart),
            isNull(subscriptionPeriods.deletedAt),
          ),
        )
        .limit(1);
      if (existing) {
        await db
          .update(subscriptionPeriods)
          .set({ [field]: date })
          .where(eq(subscriptionPeriods.id, existing.id));
      } else {
        await db.insert(subscriptionPeriods).values({
          organizationId: orgId,
          subscriptionId,
          periodStart,
          [field]: date,
        });
      }
      await logWeb(orgId, "update", "subscription", subscriptionId, `${periodStart} ${field}`);
      revalidatePath("/billing");
      revalidatePath("/subscriptions");
      await syncCalendarBestEffort(orgId);
      return { ok: true };
    }

    return { ok: false, error: "無法辨識的項目" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

// ---- 看板就地推進：登記收款（migrations/0019 的配套，無 schema 變動）----

export type PaymentCandidate = {
  id: number;
  txnDate: string;
  description: string | null;
  amount: number;
  currency: string;
  partyName: string | null;
  /** 與該期應收金額差多少（0 = 完全吻合） */
  gap: number;
};

/** 看板「登記收款」的候選交易：還沒綁到任何請款來源的收入。 */
const PAYMENT_MATCH_LIMIT = 8;

/**
 * 找出可能就是這一期收款的既有交易。
 *
 * 只看「收入、尚未綁到任何請款項目或訂閱期別、同幣別」的交易 —— 已經綁走的
 * 再列出來只會讓人重複綁。排序把同一個客戶、金額最接近的放前面；金額差距不設
 * 硬門檻，因為部分收款、扣手續費、匯差都會讓數字對不齊，讓人自己判斷比較準。
 */
export async function suggestPaymentMatches(input: {
  expected: number;
  currency: string;
  customerPartyId: number | null;
}): Promise<PaymentCandidate[]> {
  const { orgId } = await requireOrg();
  const rows = await getDb()
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      amount: transactions.amount,
      currency: transactions.currency,
      partyId: transactions.partyId,
      partyName: parties.name,
    })
    .from(transactions)
    .leftJoin(parties, eq(parties.id, transactions.partyId))
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.type, "income"),
        eq(transactions.currency, input.currency),
        isNull(transactions.deletedAt),
        isNull(transactions.billingItemId),
        isNull(transactions.subscriptionId),
      ),
    )
    .orderBy(desc(transactions.txnDate))
    .limit(200);

  const samePartyRank = (partyId: number | null) =>
    input.customerPartyId != null && partyId === input.customerPartyId ? 0 : 1;

  return rows
    .slice()
    .sort(
      (a, b) =>
        samePartyRank(a.partyId) - samePartyRank(b.partyId) ||
        Math.abs(Number(a.amount) - input.expected) -
          Math.abs(Number(b.amount) - input.expected),
    )
    .slice(0, PAYMENT_MATCH_LIMIT)
    .map((r) => ({
      id: r.id,
      txnDate: r.txnDate,
      description: r.description,
      amount: Number(r.amount),
      currency: r.currency,
      partyName: r.partyName,
      gap: Math.abs(Number(r.amount) - input.expected),
    }));
}

/**
 * 把一筆既有交易認列為某一期的收款。
 *
 * 綁定後「已收多少」由交易金額自動算出（見 queries 的 billingItemPaidById），
 * 所以這裡只寫關聯與 paid_on，不去改任何金額欄位。
 */
export async function linkPaymentToBillingRow(
  rowKey: string,
  transactionId: number,
): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const [txn] = await db
      .select({ id: transactions.id, txnDate: transactions.txnDate })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.id, transactionId),
          isNull(transactions.deletedAt),
        ),
      )
      .limit(1);
    if (!txn) return { ok: false, error: "找不到這筆交易" };

    if (rowKey.startsWith("bi:")) {
      const itemId = Number(rowKey.slice(3));
      if (!Number.isFinite(itemId)) return { ok: false, error: "項目代號不正確" };
      const [item] = await db
        .select({
          id: billingItems.id,
          contractId: billingItems.contractId,
          projectId: billingItems.projectId,
          customerPartyId: billingItems.customerPartyId,
        })
        .from(billingItems)
        .where(
          and(
            eq(billingItems.organizationId, orgId),
            eq(billingItems.id, itemId),
            isNull(billingItems.deletedAt),
          ),
        )
        .limit(1);
      if (!item) return { ok: false, error: "找不到這筆請款項目" };

      // 交易上還沒填的關聯順手補上（已經有值的不覆蓋，人填的優先）。
      await db
        .update(transactions)
        .set({
          billingItemId: itemId,
          partyId: sql`coalesce(${transactions.partyId}, ${item.customerPartyId})`,
          contractId: sql`coalesce(${transactions.contractId}, ${item.contractId})`,
          projectId: sql`coalesce(${transactions.projectId}, ${item.projectId})`,
        })
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, transactionId)));
      await db
        .update(billingItems)
        .set({ paidOn: txn.txnDate })
        .where(
          and(
            eq(billingItems.organizationId, orgId),
            eq(billingItems.id, itemId),
            isNull(billingItems.paidOn),
          ),
        );
      await logWeb(orgId, "update", "billing_item", itemId, `收款配對 #${transactionId}`);
    } else if (rowKey.startsWith("sub:")) {
      const [, rawId, periodStart] = rowKey.split(":");
      const subscriptionId = Number(rawId);
      if (!Number.isFinite(subscriptionId) || !periodStart) {
        return { ok: false, error: "期別代號不正確" };
      }
      const [sub] = await db
        .select({
          customerPartyId: subscriptions.customerPartyId,
          projectId: subscriptions.projectId,
        })
        .from(subscriptions)
        .where(
          and(eq(subscriptions.organizationId, orgId), eq(subscriptions.id, subscriptionId)),
        )
        .limit(1);
      if (!sub) return { ok: false, error: "找不到這張訂閱" };
      await db
        .update(transactions)
        .set({
          subscriptionId,
          subscriptionPeriod: periodStart,
          partyId: sql`coalesce(${transactions.partyId}, ${sub.customerPartyId})`,
          projectId: sql`coalesce(${transactions.projectId}, ${sub.projectId})`,
        })
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, transactionId)));
      await logWeb(
        orgId,
        "update",
        "subscription",
        subscriptionId,
        `${periodStart} 收款配對 #${transactionId}`,
      );
      revalidatePath("/subscriptions");
    } else {
      return { ok: false, error: "無法辨識的項目" };
    }

    revalidateBilling();
    revalidatePath("/transactions");
    await syncCalendarBestEffort(orgId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "配對失敗" };
  }
}

// ---- MCP / OAuth clients ----

// Revoke (delete) an MCP client registration. Cascades to its access/refresh
// tokens and consents (FK on delete cascade), so the client must re-authorize.
// Deployment-wide action — gated to org owners/admins.
export async function revokeMcpClient(clientId: string): Promise<ActionState> {
  try {
    const { orgId, userId } = await requireOrg();
    const db = getDb();
    const role = (
      await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
        .limit(1)
    )[0]?.role;
    if (role !== "owner" && role !== "admin") {
      return { ok: false, error: "只有擁有者或管理員可以撤銷 MCP 用戶端" };
    }
    await db
      .delete(oauthApplication)
      .where(eq(oauthApplication.clientId, clientId));
    revalidatePath("/settings/mcp");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "撤銷失敗" };
  }
}
