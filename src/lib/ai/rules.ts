/**
 * AI 規則（ai_rules，migrations/0040）的純函式：比對分類規則、把規則寫成 system prompt 裡的一行。
 * 不碰 DB，網頁 AI、聊天 bot、Wise／卡費匯入都用同一份比對邏輯（教一次兩邊都變快）。
 *
 * 規則的形狀：
 * - match  { partyContains?, taxId?, keyword? }：有寫的條件全部要成立（AND）。
 *          partyContains 不分大小寫比對對象名稱；taxId 比對統編（只看數字）；
 *          keyword 不分大小寫比對對象名稱或摘要。
 * - action { categoryId?, categoryName? }：categoryName 是建規則當下的分類名稱，只拿來顯示。
 */

export type AiRuleScope = "org" | "user";
export type AiRuleKind = "category" | "advance_default" | "note";

export type RuleMatch = { partyContains?: string; taxId?: string; keyword?: string };
export type RuleAction = { categoryId?: number; categoryName?: string };

/** 比對需要的欄位（db/ai-rules.ts 的 AiRuleRow 是它的超集）。 */
export type RuleLike = {
  id: number;
  scope: AiRuleScope;
  userId: string | null;
  kind: AiRuleKind;
  match: RuleMatch;
  action: RuleAction;
  text: string;
  disabledAt?: string | null;
};

export type RuleInput = {
  partyName?: string | null;
  taxId?: string | null;
  description?: string | null;
};

function norm(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function digits(s: string | null | undefined): string {
  return (s ?? "").replaceAll(/\D/g, "");
}

/** 這條規則的條件是否全部成立；沒有任何條件的規則永遠不成立。回傳分數（越精準越高），不成立回 0。 */
function score(rule: RuleLike, input: RuleInput): number {
  const m = rule.match ?? {};
  const party = norm(input.partyName);
  const desc = norm(input.description);
  let s = 0;
  let conditions = 0;
  if (m.taxId && digits(m.taxId)) {
    conditions++;
    if (digits(m.taxId) !== digits(input.taxId)) return 0;
    s += 100; // 統編比名稱準
  }
  if (m.partyContains && norm(m.partyContains)) {
    conditions++;
    if (!party.includes(norm(m.partyContains))) return 0;
    s += 10;
  }
  if (m.keyword && norm(m.keyword)) {
    conditions++;
    const k = norm(m.keyword);
    if (!party.includes(k) && !desc.includes(k)) return 0;
    s += 1;
  }
  return conditions > 0 ? s : 0;
}

/** 條件裡最長的那段字（越長越具體，用來打破同分）。 */
function specificity(rule: RuleLike): number {
  const m = rule.match ?? {};
  return Math.max(norm(m.partyContains).length, norm(m.keyword).length, digits(m.taxId).length);
}

/**
 * 找出最適合這筆交易的分類規則；沒有就回 null。
 * - 只看 kind = category、沒停用、action 有 categoryId 的規則。
 * - 個人規則只套在 userId 本人（opts.userId 有給時才檢查；呼叫端通常已先篩過）。
 * - 統編 > 對象名稱 > 關鍵字；同分時個人規則優先，再來是條件較長的，最後是較新的（id 大）。
 */
export function matchCategoryRule<R extends RuleLike>(
  rules: readonly R[],
  input: RuleInput,
  opts: { userId?: string } = {},
): R | null {
  let best: { rule: R; score: number } | null = null;
  for (const rule of rules) {
    if (rule.kind !== "category" || rule.disabledAt) continue;
    if (typeof rule.action?.categoryId !== "number") continue;
    if (rule.scope === "user" && opts.userId !== undefined && rule.userId !== opts.userId) continue;
    const s = score(rule, input);
    if (s === 0) continue;
    if (!best || better(rule, s, best.rule, best.score)) best = { rule, score: s };
  }
  return best?.rule ?? null;
}

function better(a: RuleLike, sa: number, b: RuleLike, sb: number): boolean {
  if (sa !== sb) return sa > sb;
  if (a.scope !== b.scope) return a.scope === "user";
  const pa = specificity(a);
  const pb = specificity(b);
  if (pa !== pb) return pa > pb;
  return a.id > b.id;
}

/** 規則條件的簡短說法（卡片提示、規則頁用），例如「Google Workspace」「統編 12345678」。 */
export function ruleConditionLabel(rule: Pick<RuleLike, "match">, locale: "zh-TW" | "en" = "zh-TW"): string {
  const m = rule.match ?? {};
  const parts: string[] = [];
  if (m.taxId) parts.push(locale === "en" ? `tax ID ${m.taxId}` : `統編 ${m.taxId}`);
  if (m.partyContains) parts.push(m.partyContains);
  if (m.keyword) parts.push(locale === "en" ? `“${m.keyword}”` : `「${m.keyword}」`);
  return parts.join(" + ");
}

/** 待確認卡上的提示：「依規則：Google Workspace → 軟體工具」。 */
export function ruleHintText(rule: Pick<RuleLike, "match" | "action">, locale: "zh-TW" | "en" = "zh-TW"): string {
  const target = rule.action.categoryName ?? `#${rule.action.categoryId}`;
  const cond = ruleConditionLabel(rule, locale);
  return locale === "en" ? `By rule: ${cond} → ${target}` : `依規則：${cond} → ${target}`;
}

/** system prompt 裡的一行（英文骨架，原話照抄）。 */
export function rulePromptLine(rule: RuleLike): string {
  const who = rule.scope === "org" ? "org" : "mine";
  const said = rule.text.replaceAll(/\s+/g, " ").trim().slice(0, 200);
  if (rule.kind === "category") {
    const m = rule.match ?? {};
    const cond = [
      m.taxId ? `tax ID = ${m.taxId}` : null,
      m.partyContains ? `counterparty contains "${m.partyContains}"` : null,
      m.keyword ? `name or description contains "${m.keyword}"` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    const cat = rule.action.categoryName
      ? `categoryId ${rule.action.categoryId} (${rule.action.categoryName})`
      : `categoryId ${rule.action.categoryId}`;
    return `- [${who} #${rule.id}] if ${cond || "(no condition)"} → ${cat}. User said: ${said}`;
  }
  const label = rule.kind === "advance_default" ? "default payer" : "note";
  return `- [${who} #${rule.id} ${label}] ${said}`;
}
