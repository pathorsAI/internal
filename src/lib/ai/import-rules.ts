/**
 * 匯入（Wise 同步、雲端帳單建的待確認支出…）套用 AI 分類規則。
 *
 * 規則：
 * - 只處理「待確認（needs_review）、還沒有分類、收入或支出」的列；其他列原樣不動。
 * - 只套**組織**規則（匯入沒有操作人，不能套任何人的個人規則），比對邏輯與網頁 AI、
 *   聊天 bot 共用 src/lib/ai/rules.ts 的 matchCategoryRule。
 * - 只填分類，**needs_review 保留**：規則幫忙先選好分類，還是要有人看過一次。
 * - 分類要還在、而且種類跟交易類型合得來（收入不能套到支出分類），不然當作沒對到。
 * - 讀規則失敗不能讓匯入失敗：出錯就當作沒有規則，照原樣匯入。
 * - 實際寫進去之後才呼叫 recordImportRuleApplications 記套用次數（被去重擋下的不算）。
 */
import { listCategoryKinds, listOrgCategoryRules, recordAiRuleApplications } from "@/db/ai-rules";
import { matchCategoryRule, type RuleLike } from "./rules";

export type ImportCategoryRow = {
  type: string;
  categoryId: number | null;
  needsReview: boolean;
  partyName: string | null;
  taxId?: string | null;
  description?: string | null;
};

/** 每一種交易類型能套哪些分類種類（categories.kind）。 */
const FITS: Record<string, readonly string[]> = {
  income: ["income", "non_operating"],
  expense: ["expense", "cogs", "non_operating"],
};

/** 這個分類種類能不能用在這種交易上。轉帳、代墊等其他類型匯入時不套規則。 */
export function categoryFitsType(kind: string | undefined, type: string): boolean {
  return kind !== undefined && (FITS[type] ?? []).includes(kind);
}

/** 這一列要不要套規則。 */
export function wantsRule(row: ImportCategoryRow): boolean {
  return row.needsReview && row.categoryId === null && FITS[row.type] !== undefined;
}

/**
 * 純函式：每一列對到哪條規則、要填哪個分類（對不到是 null）。
 * categoryKinds：規則指到的分類 id → 種類，只放這個組織還在用的分類。
 */
export function planImportCategories<R extends RuleLike>(
  rows: readonly ImportCategoryRow[],
  rules: readonly R[],
  categoryKinds: ReadonlyMap<number, string>,
): ({ categoryId: number; ruleId: number } | null)[] {
  // 先把指到不存在或種類不合的分類的規則篩掉，matchCategoryRule 才會退到下一條合用的。
  return rows.map((row) => {
    if (!wantsRule(row)) return null;
    const usable = rules.filter((r) => {
      const id = r.action?.categoryId;
      return r.scope === "org" && typeof id === "number" && categoryFitsType(categoryKinds.get(id), row.type);
    });
    const rule = matchCategoryRule(usable, {
      partyName: row.partyName,
      taxId: row.taxId ?? null,
      description: row.description ?? null,
    });
    const categoryId = rule?.action.categoryId;
    return rule && typeof categoryId === "number" ? { categoryId, ruleId: rule.id } : null;
  });
}

export type ImportRulesDeps = {
  listRules: (orgId: string) => Promise<RuleLike[]>;
  categoryKinds: (orgId: string, ids: readonly number[]) => Promise<Map<number, string>>;
  recordApplications: (counts: ReadonlyMap<number, number>) => Promise<void>;
};

export const defaultImportRulesDeps: ImportRulesDeps = {
  listRules: (orgId) => listOrgCategoryRules(orgId),
  categoryKinds: (orgId, ids) => listCategoryKinds(orgId, ids),
  recordApplications: (counts) => recordAiRuleApplications(counts),
};

/**
 * 匯入前呼叫：回傳填好分類的列（新物件，順序不變）與每列用到的規則 id（沒用到是 null）。
 * 沒有規則、或讀規則失敗，就原樣回傳。
 */
export async function applyImportCategoryRules<T extends ImportCategoryRow>(
  orgId: string,
  rows: readonly T[],
  deps: ImportRulesDeps = defaultImportRulesDeps,
): Promise<{ rows: T[]; ruleIds: (number | null)[] }> {
  const untouched = { rows: [...rows], ruleIds: rows.map(() => null) };
  if (!rows.some(wantsRule)) return untouched;
  try {
    const rules = await deps.listRules(orgId);
    if (rules.length === 0) return untouched;
    const ids = [
      ...new Set(rules.map((r) => r.action?.categoryId).filter((id): id is number => typeof id === "number")),
    ];
    const kinds = await deps.categoryKinds(orgId, ids);
    const plan = planImportCategories(rows, rules, kinds);
    return {
      rows: rows.map((row, i) => {
        const p = plan[i];
        return p ? { ...row, categoryId: p.categoryId } : row;
      }),
      ruleIds: plan.map((p) => p?.ruleId ?? null),
    };
  } catch (e) {
    console.error(`[import-rules] skipped for ${orgId}: ${e instanceof Error ? e.message : String(e)}`);
    return untouched;
  }
}

/** 匯入寫進去之後：每條規則的套用次數加上這次實際用到的筆數。失敗只記 log。 */
export async function recordImportRuleApplications(
  ruleIds: readonly (number | null)[],
  deps: ImportRulesDeps = defaultImportRulesDeps,
): Promise<void> {
  const counts = new Map<number, number>();
  for (const id of ruleIds) if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  if (counts.size === 0) return;
  try {
    await deps.recordApplications(counts);
  } catch (e) {
    console.error(`[import-rules] could not record applications: ${e instanceof Error ? e.message : String(e)}`);
  }
}
