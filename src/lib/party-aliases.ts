// 交易對象別名與名稱比對（純函式，client 與 server 都會用；migrations/0033）。
//
// 匯入來源（Wise、MCP 建交易、表單客戶欄、Simpany 同步）都只拿得到一個對象「名稱」字串，
// 要把它對到帳本上的交易對象。規則：
//
//   1. 名稱完全相同（不分大小寫、前後空白不算）
//   2. 某個一般別名完全相同
//   3. 以 `*` 結尾的別名當前綴：`Facebk *` 吃 `Facebk *26qx2aj6e4`；多個前綴都中時取最長的
//
// 同一層有多筆時取 id 最小的，結果穩定。呼叫端只能傳入「未刪除」的交易對象 ——
// 軟刪除的對象不該再吃掉新匯入的交易。

export type PartyCandidate = {
  id: number;
  name: string;
  aliases: readonly string[];
};

const PREFIX_MARK = "*";

/** 比對用的正規化：去掉前後空白、轉小寫。 */
export function foldPartyName(s: string): string {
  return s.trim().toLowerCase();
}

/** 以 `*` 結尾的別名是前綴比對。 */
export function isPrefixAlias(alias: string): boolean {
  return alias.trim().endsWith(PREFIX_MARK);
}

/** 前綴別名去掉結尾 `*` 之後、正規化過的前綴（`Facebk *` → `facebk `）。 */
function prefixOf(alias: string): string {
  const t = alias.trim();
  return t.slice(0, -PREFIX_MARK.length).toLowerCase();
}

/** 符合條件的候選裡 id 最小的。 */
function lowestId(candidates: readonly PartyCandidate[], hit: (c: PartyCandidate) => boolean): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    if ((best === null || c.id < best) && hit(c)) best = c.id;
  }
  return best;
}

/** 前綴別名裡最長的那個吃到 key 的候選；同長度取 id 最小的。 */
function longestPrefixId(candidates: readonly PartyCandidate[], key: string): number | null {
  let best: { id: number; length: number } | null = null;
  for (const c of candidates) {
    for (const alias of c.aliases) {
      if (!isPrefixAlias(alias)) continue;
      const prefix = prefixOf(alias);
      if (!prefix || !key.startsWith(prefix)) continue;
      const better =
        best === null || prefix.length > best.length || (prefix.length === best.length && c.id < best.id);
      if (better) best = { id: c.id, length: prefix.length };
    }
  }
  return best?.id ?? null;
}

/**
 * 把一個名稱對到交易對象 id；都沒中就回 null（由呼叫端決定要不要新建）。
 * `candidates` 必須已經過濾成同一組織、未刪除的交易對象。
 */
export function matchParty(candidates: readonly PartyCandidate[], name: string): number | null {
  const key = foldPartyName(name);
  if (!key) return null;
  return (
    lowestId(candidates, (c) => foldPartyName(c.name) === key) ??
    lowestId(candidates, (c) => c.aliases.some((a) => !isPrefixAlias(a) && foldPartyName(a) === key)) ??
    longestPrefixId(candidates, key)
  );
}

/**
 * 整理別名清單：去空白、丟掉空的與只有 `*` 的（會吃掉所有名稱）、不分大小寫去重（保留第一次
 * 出現的寫法），也丟掉跟交易對象本身名稱相同的（名稱本來就會比對）。
 */
export function normalizeAliases(raw: readonly string[], ownName?: string | null): string[] {
  const own = ownName ? foldPartyName(ownName) : null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const alias = r.trim();
    if (!alias) continue;
    if (isPrefixAlias(alias) && !prefixOf(alias).trim()) continue;
    const key = foldPartyName(alias);
    if (key === own || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** 表單 textarea（一行一個）→ 別名清單。 */
export function parseAliasesText(text: string | null | undefined, ownName?: string | null): string[] {
  if (!text) return [];
  return normalizeAliases(text.split(/\r?\n/), ownName);
}

/** 合併時目標的新別名：目標原本的 + 每個來源的名稱與別名。 */
export function mergedAliases(
  target: Pick<PartyCandidate, "name" | "aliases">,
  sources: readonly Pick<PartyCandidate, "name" | "aliases">[],
): string[] {
  return normalizeAliases(
    [...target.aliases, ...sources.flatMap((s) => [s.name, ...s.aliases])],
    target.name,
  );
}
