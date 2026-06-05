"use server";

import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { getDb } from "./index";
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
  contracts,
  receivables,
} from "./schema";
import { uploadDocument, deleteDocument } from "@/lib/storage";
import { requireOrg } from "@/lib/session";

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
    await getDb()
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
      });
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
    await getDb()
      .insert(accountReconciliations)
      .values({
        organizationId: orgId,
        accountId,
        asOfDate,
        statementBalance,
        note: str(formData.get("note")),
      });
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
  const categoryId = num(formData.get("categoryId"));
  if (!categoryId) return { error: "請選擇分類" };
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
  const categoryId = num(formData.get("categoryId"));
  if (!categoryId) return { error: "請選擇分類" };
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

    await db.insert(transactions).values({
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
    });

    revalidatePath("/advances");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "撥款失敗" };
  }
}

const fkError = (e: unknown, busy: string) => {
  const err = e as { code?: string; message?: string };
  const msg = err?.message ?? "";
  const isFk = err?.code === "23503" || /foreign key|violates/i.test(msg);
  return { ok: false as const, error: isFk ? busy : msg || "刪除失敗" };
};

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
    await getDb().insert(categories).values({ organizationId: orgId, name, kind });
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
      .delete(categories)
      .where(and(eq(categories.organizationId, orgId), eq(categories.id, id)));
    revalidatePath("/categories");
    revalidatePath("/transactions");
    return { ok: true };
  } catch (e) {
    return fkError(e, "此分類已被交易使用，無法刪除（可改名或先把相關交易換分類）");
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
    await getDb().insert(bankAccounts).values({
      organizationId: orgId,
      name,
      kind: str(formData.get("kind")) ?? "bank",
      currency: str(formData.get("currency")) ?? "TWD",
      openingBalance: str(formData.get("openingBalance")) ?? "0",
      isActive: true,
    });
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
      .delete(bankAccounts)
      .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, id)));
    revalidatePath("/bank-accounts");
    return { ok: true };
  } catch (e) {
    return fkError(e, "此帳戶已被交易或對帳使用，無法刪除，請改為停用");
  }
}

// ---- 員工 ----
export async function createEmployee(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "請輸入姓名" };
  const laborInsured = str(formData.get("laborInsuredSalary"));
  const healthInsured = str(formData.get("healthInsuredSalary"));
  try {
    const { orgId } = await requireOrg();
    await getDb()
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
        isActive: true,
      });
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
  const laborInsured = str(formData.get("laborInsuredSalary"));
  const healthInsured = str(formData.get("healthInsuredSalary"));
  try {
    const { orgId } = await requireOrg();
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
        isActive: formData.get("isActive") === "on",
      })
      .where(and(eq(employees.organizationId, orgId), eq(employees.id, id)));
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
      .delete(employees)
      .where(and(eq(employees.organizationId, orgId), eq(employees.id, id)));
    revalidatePath("/employees");
    return { ok: true };
  } catch (e) {
    return fkError(e, "這位員工已經有交易或薪資紀錄，不能直接刪除；請改用編輯把「在職」取消（改為離職）。");
  }
}

// ---- 交易對象 / 交易 刪除 ----
export async function deleteParty(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .delete(parties)
      .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)));
    revalidatePath("/parties");
    return { ok: true };
  } catch (e) {
    return fkError(e, "此交易對象已被交易使用，無法刪除，請改為停用");
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
    // 先清掉這筆交易的憑證（R2 檔 + documents 列），不要留孤兒檔
    const docs = await db
      .select({ r2Key: documents.r2Key })
      .from(documents)
      .where(eq(documents.transactionId, id));
    for (const d of docs) {
      if (d.r2Key && !d.r2Key.startsWith("meta/")) await deleteDocument(d.r2Key);
    }
    if (docs.length > 0) {
      await db.delete(documents).where(eq(documents.transactionId, id));
    }
    await db.delete(transactions).where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)));
    revalidatePath("/transactions");
    revalidatePath("/advances");
    revalidatePath("/accountant-notices");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fkError(e, "這筆交易被其他紀錄連結（例如代墊已有撥款），請先處理那筆再刪。");
  }
}

// 刪除交易的某筆憑證（連同 R2 檔案）
export async function deleteTransactionDocument(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const [doc] = await db
      .select({ r2Key: documents.r2Key })
      .from(documents)
      .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)))
      .limit(1);
    if (!doc) return { ok: false, error: "找不到該憑證" };
    await db.delete(documents).where(and(eq(documents.organizationId, orgId), eq(documents.id, id)));
    if (doc?.r2Key && !doc.r2Key.startsWith("meta/")) {
      await deleteDocument(doc.r2Key);
    }
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
        fromAccountId: f.fromAccountId,
        toAccountId: f.toAccountId,
        book,
        billedToCompanyTaxId: billed,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)));
    // 編輯時若有補上憑證，新增一筆 documents
    await storeTransactionDocument(db, orgId, id, formData, billed);
    revalidatePath("/transactions");
    revalidatePath("/accountant-notices");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

// ---- 發票 ----
function invoiceValues(formData: FormData) {
  return {
    direction: str(formData.get("direction")) ?? "received",
    invoiceNumber: str(formData.get("invoiceNumber")),
    invoiceDate: str(formData.get("invoiceDate")),
    counterpartyName: str(formData.get("counterpartyName")),
    counterpartyTaxId: str(formData.get("counterpartyTaxId")),
    amountNet: str(formData.get("amountNet")),
    tax: str(formData.get("tax")),
    amountGross: str(formData.get("amountGross")),
    currency: str(formData.get("currency")) ?? "TWD",
    status: str(formData.get("status")) ?? "valid",
    note: str(formData.get("note")),
  };
}

export async function createInvoice(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb().insert(invoices).values({ organizationId: orgId, ...invoiceValues(formData) });
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
    await getDb()
      .update(invoices)
      .set(invoiceValues(formData))
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, id)));
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
      .delete(invoices)
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, id)));
    revalidatePath("/invoices");
    return { ok: true };
  } catch (e) {
    return fkError(e, "此發票已連結交易，無法刪除，請先解除連結");
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
      .delete(accountReconciliations)
      .where(and(eq(accountReconciliations.organizationId, orgId), eq(accountReconciliations.id, id)));
    revalidatePath("/reconciliation");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// ---- 薪資（刪除整期；payslips 隨之 cascade）----
export async function deletePayrollRun(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .delete(payrollRuns)
      .where(and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.id, id)));
    revalidatePath("/payroll");
    return { ok: true };
  } catch (e) {
    return fkError(e, "此批次已有發放的薪資（連到交易），請先處理相關交易");
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
    await db.delete(payslips).where(eq(payslips.id, id));
    if (slip?.paidTransactionId) {
      await db
        .delete(transactions)
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, slip.paidTransactionId)));
    }
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
    await getDb().insert(projects).values({
      organizationId: orgId,
      name,
      clientPartyId: num(formData.get("clientPartyId")),
      status,
      description: str(formData.get("description")),
    });
    revalidatePath("/projects");
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
    await getDb()
      .update(projects)
      .set({
        name,
        clientPartyId: num(formData.get("clientPartyId")),
        status,
        description: str(formData.get("description")),
      })
      .where(and(eq(projects.organizationId, orgId), eq(projects.id, id)));
    revalidatePath("/projects");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteProject(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .delete(projects)
      .where(and(eq(projects.organizationId, orgId), eq(projects.id, id)));
    revalidatePath("/projects");
    return { ok: true };
  } catch (e) {
    return fkError(e, "此專案已被交易或合約使用，無法刪除；可改為「封存」");
  }
}

// ---- 訂閱 / 月費 ----
const SUBSCRIPTION_STATUS = new Set(["active", "paused", "ended"]);

function subscriptionValues(formData: FormData) {
  return {
    customerPartyId: num(formData.get("customerPartyId")),
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
  if (!v.customerPartyId) return { ok: false, error: "請選擇客戶" };
  if (!v.name) return { ok: false, error: "請輸入方案名稱" };
  if (v.amount === null) return { ok: false, error: "請輸入金額" };
  if (!v.startDate) return { ok: false, error: "請選擇開始日期" };
  if (!SUBSCRIPTION_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .insert(subscriptions)
      .values({
        organizationId: orgId,
        customerPartyId: v.customerPartyId,
        projectId: v.projectId,
        name: v.name,
        amount: v.amount,
        currency: v.currency,
        intervalMonths: v.intervalMonths,
        startDate: v.startDate,
        endDate: v.endDate,
        status: v.status,
        note: v.note,
      });
    revalidatePath("/subscriptions");
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
  if (!v.customerPartyId) return { ok: false, error: "請選擇客戶" };
  if (!v.name) return { ok: false, error: "請輸入方案名稱" };
  if (v.amount === null) return { ok: false, error: "請輸入金額" };
  if (!v.startDate) return { ok: false, error: "請選擇開始日期" };
  if (!SUBSCRIPTION_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(subscriptions)
      .set({
        customerPartyId: v.customerPartyId,
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
    revalidatePath("/subscriptions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteSubscription(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .delete(subscriptions)
      .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.id, id)));
    revalidatePath("/subscriptions");
    return { ok: true };
  } catch (e) {
    return fkError(e, "此訂閱已被應收帳款連結，無法刪除");
  }
}

// ---- 合約 ----
const CONTRACT_STATUS = new Set(["draft", "active", "completed", "cancelled"]);

function contractValues(formData: FormData) {
  return {
    customerPartyId: num(formData.get("customerPartyId")),
    projectId: num(formData.get("projectId")),
    title: str(formData.get("title")),
    amount: str(formData.get("amount")),
    currency: str(formData.get("currency")) ?? "TWD",
    startDate: str(formData.get("startDate")),
    endDate: str(formData.get("endDate")),
    status: str(formData.get("status")) ?? "active",
    note: str(formData.get("note")),
  };
}

export async function createContract(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const v = contractValues(formData);
  if (!v.customerPartyId) return { ok: false, error: "請選擇客戶" };
  if (!v.title) return { ok: false, error: "請輸入合約名稱" };
  if (!CONTRACT_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .insert(contracts)
      .values({
        organizationId: orgId,
        customerPartyId: v.customerPartyId,
        projectId: v.projectId,
        title: v.title,
        amount: v.amount,
        currency: v.currency,
        startDate: v.startDate,
        endDate: v.endDate,
        status: v.status,
        note: v.note,
      });
    revalidatePath("/contracts");
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
  if (!v.customerPartyId) return { ok: false, error: "請選擇客戶" };
  if (!v.title) return { ok: false, error: "請輸入合約名稱" };
  if (!CONTRACT_STATUS.has(v.status)) return { ok: false, error: "狀態不正確" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(contracts)
      .set({
        customerPartyId: v.customerPartyId,
        projectId: v.projectId,
        title: v.title,
        amount: v.amount,
        currency: v.currency,
        startDate: v.startDate,
        endDate: v.endDate,
        status: v.status,
        note: v.note,
      })
      .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, id)));
    revalidatePath("/contracts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteContract(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .delete(contracts)
      .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, id)));
    revalidatePath("/contracts");
    return { ok: true };
  } catch (e) {
    return fkError(e, "此合約已被應收帳款連結，無法刪除");
  }
}

// ---- 應收帳款 ----
function receivableValues(formData: FormData) {
  return {
    customerPartyId: num(formData.get("customerPartyId")),
    contractId: num(formData.get("contractId")),
    subscriptionId: num(formData.get("subscriptionId")),
    projectId: num(formData.get("projectId")),
    description: str(formData.get("description")),
    amount: str(formData.get("amount")),
    currency: str(formData.get("currency")) ?? "TWD",
    dueDate: str(formData.get("dueDate")),
  };
}

export async function createReceivable(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const v = receivableValues(formData);
  if (!v.customerPartyId) return { ok: false, error: "請選擇客戶" };
  if (v.amount === null) return { ok: false, error: "請輸入金額" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .insert(receivables)
      .values({
        organizationId: orgId,
        customerPartyId: v.customerPartyId,
        contractId: v.contractId,
        subscriptionId: v.subscriptionId,
        projectId: v.projectId,
        description: v.description,
        amount: v.amount,
        currency: v.currency,
        dueDate: v.dueDate,
        status: "open",
      });
    revalidatePath("/receivables");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "新增失敗" };
  }
}

export async function updateReceivable(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  if (!id) return { ok: false, error: "缺少 ID" };
  const v = receivableValues(formData);
  if (!v.customerPartyId) return { ok: false, error: "請選擇客戶" };
  if (v.amount === null) return { ok: false, error: "請輸入金額" };
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .update(receivables)
      .set({
        customerPartyId: v.customerPartyId,
        contractId: v.contractId,
        subscriptionId: v.subscriptionId,
        projectId: v.projectId,
        description: v.description,
        amount: v.amount,
        currency: v.currency,
        dueDate: v.dueDate,
      })
      .where(and(eq(receivables.organizationId, orgId), eq(receivables.id, id)));
    revalidatePath("/receivables");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}

export async function deleteReceivable(id: number): Promise<ActionState> {
  try {
    const { orgId } = await requireOrg();
    await getDb()
      .delete(receivables)
      .where(and(eq(receivables.organizationId, orgId), eq(receivables.id, id)));
    revalidatePath("/receivables");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "刪除失敗" };
  }
}

// 收款：把一筆 open 的應收帳款結掉 → 建一筆 type=income 收入交易（記到客戶 + 專案），
// 並把應收標記為已收（連到該筆交易）。
export async function collectReceivable(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = num(formData.get("id"));
  const accountId = num(formData.get("accountId"));
  const payDate = str(formData.get("payDate"));
  if (!id) return { ok: false, error: "缺少應收帳款" };
  if (!accountId) return { ok: false, error: "請選擇收款帳戶" };
  if (!payDate) return { ok: false, error: "請選擇收款日期" };
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const [ar] = await db
      .select({
        customerPartyId: receivables.customerPartyId,
        projectId: receivables.projectId,
        amount: receivables.amount,
        currency: receivables.currency,
        status: receivables.status,
        description: receivables.description,
      })
      .from(receivables)
      .where(and(eq(receivables.organizationId, orgId), eq(receivables.id, id)))
      .limit(1);
    if (!ar) return { ok: false, error: "找不到該應收帳款" };
    if (ar.status === "paid") return { ok: false, error: "這筆已收款" };

    const currency = ar.currency ?? "TWD";
    const [txn] = await db
      .insert(transactions)
      .values({
        organizationId: orgId,
        type: "income",
        txnDate: payDate,
        description: ar.description ?? "應收帳款收款",
        partyId: ar.customerPartyId,
        projectId: ar.projectId,
        amount: ar.amount,
        currency,
        amountTwd: currency === "TWD" ? ar.amount : null,
        toAccountId: accountId,
        book: "both",
        billedToCompanyTaxId: false,
      })
      .returning({ id: transactions.id });

    await db
      .update(receivables)
      .set({ status: "paid", paidTransactionId: txn.id, paidAt: payDate })
      .where(and(eq(receivables.organizationId, orgId), eq(receivables.id, id)));

    revalidatePath("/receivables");
    revalidatePath("/transactions");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "收款失敗" };
  }
}
