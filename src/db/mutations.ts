"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "./index";
import { suppliers, accountReconciliations } from "./schema";

export type ActionState = { ok: boolean; error?: string };

function str(v: FormDataEntryValue | null) {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}
function num(v: FormDataEntryValue | null) {
  const s = str(v);
  return s === null ? null : Number(s);
}

export async function createSupplier(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const name = str(formData.get("name"));
  if (!name) return { ok: false, error: "請輸入供應商名稱" };

  try {
    await getDb()
      .insert(suppliers)
      .values({
        name,
        taxId: str(formData.get("taxId")),
        defaultCurrency: str(formData.get("defaultCurrency")),
        defaultAccountId: num(formData.get("defaultAccountId")),
        typicalAmount: str(formData.get("typicalAmount")),
        contact: str(formData.get("contact")),
        note: str(formData.get("note")),
      });
    revalidatePath("/suppliers");
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
    await getDb()
      .insert(accountReconciliations)
      .values({
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
