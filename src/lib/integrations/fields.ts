import type { IntegrationField } from "./types";

// 連接 Sheet 欄位的共用規則（client 與 server action 都用同一套，純函式）。
//
// 欄位可以帶 `when: { key, equals }`：只有另一個欄位（通常是 select）等於某個值時才適用。
// 不適用的欄位不顯示、不檢查必填、也不會被存起來 —— 例如 GCP 用 workload identity 時，
// 就不該要求、也不該存 service account key。

/** 欄位目前的值：有填用填的，沒填用 defaultValue。 */
export function fieldValue(field: IntegrationField, values: Record<string, unknown>): string {
  const v = values[field.key];
  if (typeof v === "string" && v.trim() !== "") return v;
  return field.defaultValue ?? "";
}

/** 這個欄位在目前的輸入下適不適用。 */
export function fieldApplies(
  field: IntegrationField,
  allFields: readonly IntegrationField[],
  values: Record<string, unknown>,
): boolean {
  if (!field.when) return true;
  const dep = allFields.find((f) => f.key === field.when?.key);
  const raw = values[field.when.key];
  // 沒宣告的欄位：字串／數字／布林照原樣比對，其他（null、物件）當成沒填
  const loose = typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";
  const current = dep ? fieldValue(dep, values) : loose;
  return current === field.when.equals;
}

/** 只收宣告過、且目前適用的欄位；select 只收 options 裡的值，沒填就帶 defaultValue。 */
export function pickFields(
  fields: readonly IntegrationField[] | undefined,
  allFields: readonly IntegrationField[],
  values: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields ?? []) {
    if (!fieldApplies(f, allFields, values)) continue;
    const raw = values[f.key];
    if (f.type === "select") {
      const v = fieldValue(f, values);
      if (f.options?.some((o) => o.value === v)) out[f.key] = v;
      continue;
    }
    if (typeof raw !== "string") continue;
    // 密碼不修剪（前後空白可能是密碼的一部分）；其餘欄位修掉貼上時夾帶的空白。
    const v = f.type === "password" ? raw : raw.trim();
    if (v !== "") out[f.key] = v;
  }
  return out;
}

/** 第一個「適用且必填」卻沒填的欄位；都有填就回 null。 */
export function findMissingRequiredField(
  allFields: readonly IntegrationField[],
  picked: Record<string, string>,
): IntegrationField | null {
  for (const f of allFields) {
    if (!f.required || !fieldApplies(f, allFields, picked)) continue;
    if (!(f.key in picked)) return f;
  }
  return null;
}
