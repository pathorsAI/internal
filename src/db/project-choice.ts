import type { getDb } from "./index";
import { projects } from "./schema";

/**
 * 合約表單的「歸屬專案」選項（src/components/project-choice-field.tsx 送上來的 projectChoice）：
 *
 *   "new"   新專案：名稱用合約名、客戶用合約的客戶
 *   "none"  不歸屬專案（留空也當 none）
 *   <id>    既有專案（呼叫端要驗 organization 歸屬）
 *
 * 欄位完全沒送（舊表單、其他呼叫端）回 null，讓呼叫端退回原本的 projectId 欄位。
 * 打了字卻沒選到清單項目 → invalid，擋下來，不要默默當成「不歸屬」。
 */
export type ProjectChoice = { kind: "new" } | { kind: "none" } | { kind: "id"; id: number } | { kind: "invalid" };

export function parseProjectChoice(v: FormDataEntryValue | null): ProjectChoice | null {
  if (v === null) return null;
  const s = typeof v === "string" ? v.trim() : "";
  if (s === "" || s === "none") return { kind: "none" };
  if (s === "new") return { kind: "new" };
  const id = Number(s);
  return Number.isSafeInteger(id) && id > 0 ? { kind: "id", id } : { kind: "invalid" };
}

/** 建一個跟合約同名的專案（客戶沿用合約的客戶），回傳新專案 id。 */
export async function createProjectForContract(
  db: ReturnType<typeof getDb>,
  orgId: string,
  contract: { title: string; customerPartyId: number },
): Promise<number> {
  const [row] = await db
    .insert(projects)
    .values({
      organizationId: orgId,
      name: contract.title,
      clientPartyId: contract.customerPartyId,
      status: "active",
    })
    .returning({ id: projects.id });
  return row.id;
}
