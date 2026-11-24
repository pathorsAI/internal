/**
 * 交易表單上的連結欄位（專案 / 合約 / 訂閱 / 期別 / 請款項）→ 交給連結層的 patch。
 *
 * **只收表單上真的有的欄位**：編輯表單沒有訂閱、請款項欄位，以前照樣讀 `formData.get(...)`
 * 得到 null 寫回去，存一次就把原本掛好的訂閱清掉。沒出現的 key 不放進 patch，
 * updateTransactionLinked 就會保留既有值。
 */
export type FormLinkPatch = {
  projectId?: number | null;
  contractId?: number | null;
  subscriptionId?: number | null;
  subscriptionPeriod?: string | null;
  billingItemId?: number | null;
};

type FormLike = Pick<FormData, "has" | "get">;

function text(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

/** 選填外鍵：空字串與 Radix Select 的「不綁定」（"none"）都當 null；非正整數也當 null。 */
function refId(v: FormDataEntryValue | null): number | null {
  const s = text(v);
  if (s === null || s === "none") return null;
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const ID_KEYS = ["projectId", "contractId", "subscriptionId", "billingItemId"] as const;

export function linkPatchFromForm(formData: FormLike): FormLinkPatch {
  const patch: FormLinkPatch = {};
  for (const key of ID_KEYS) {
    if (formData.has(key)) patch[key] = refId(formData.get(key));
  }
  if (formData.has("subscriptionPeriod")) patch.subscriptionPeriod = text(formData.get("subscriptionPeriod"));
  return patch;
}
