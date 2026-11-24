/**
 * 交易對象（客戶 / 廠商）名稱的相似度（純函式）。
 *
 * 完全相同（不分大小寫）與別名命中由 src/lib/party-aliases.ts 的 matchParty 處理；
 * 這裡處理「不完全相同但很可能是同一家」：公司後綴不同（LLC / Inc. / 股份有限公司）、
 * 標點空白不同、少打一兩個字、一邊是另一邊的一部分（「HNT」vs「HNT Marketing LLC」）。
 */

// 比對前拿掉的公司型態字樣（英文以整個字為單位、中文直接去掉）
const EN_SUFFIXES = new Set([
  "llc", "inc", "incorporated", "ltd", "limited", "co", "corp", "corporation", "company",
  "plc", "gmbh", "sa", "bv", "pte", "pty", "kk", "the",
]);
const ZH_SUFFIXES = ["股份有限公司", "有限公司", "企業社", "工作室", "公司", "商行", "台灣分公司", "分公司"];

/** 正規化：小寫、全形轉半形、拿掉標點與公司型態字樣、合併空白。 */
export function normalizePartyKey(name: string): string {
  let s = name.normalize("NFKC").toLowerCase();
  for (const suf of ZH_SUFFIXES) s = s.split(suf).join(" ");
  s = s.replace(/[^\p{L}\p{N}]+/gu, " ");
  const words = s.split(" ").filter((w) => w && !EN_SUFFIXES.has(w));
  return words.join(" ").trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 編輯距離，超過 max 就提早停（回傳 max + 1）。 */
function levenshteinBounded(a: string, b: string, max: number): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** 0–1，1 = 正規化後完全相同。 */
export function partySimilarity(a: string, b: string): number {
  return preparedSimilarity(prepareKey(normalizePartyKey(a)), prepareKey(normalizePartyKey(b)));
}

type PreparedKey = { key: string; compact: string; words: string[]; wordSet: Set<string> };

function prepareKey(key: string): PreparedKey {
  const words = key ? key.split(" ") : [];
  return { key, compact: key.replace(/ /g, ""), words, wordSet: new Set(words) };
}

/**
 * 同 partySimilarity，但吃預先整理好的 key（大量兩兩比對時每個名稱只整理一次）。
 * threshold > 0 時，長度差已經讓分數低於門檻就不算編輯距離（距離至少是長度差）。
 */
function preparedSimilarity(a: PreparedKey, b: PreparedKey, threshold = 0): number {
  if (!a.key || !b.key) return 0;
  if (a.key === b.key) return 1;
  if (a.compact === b.compact) return 0.98;
  // 一邊的字完整出現在另一邊（HNT ⊂ HNT Marketing）：短的那邊至少 3 個字元才算，避免「AI」吃到一堆
  const [short, long] = a.compact.length <= b.compact.length ? [a, b] : [b, a];
  if (short.compact.length >= 3) {
    if (short.words.every((w) => long.wordSet.has(w))) return 0.9;
    if (long.compact.startsWith(short.compact)) return 0.85;
  }
  const maxLen = Math.max(a.compact.length, b.compact.length);
  const floor = 1 - (long.compact.length - short.compact.length) / maxLen;
  if (threshold > 0) {
    if (floor < threshold) return floor;
    // 1e-9：(1 − 0.8) × 10 在浮點數是 1.999…，不補會把剛好 0.8 的算成不像
    const max = Math.floor((1 - threshold) * maxLen + 1e-9);
    const dist = levenshteinBounded(a.compact, b.compact, max);
    // 超過上限：真正的距離不知道，只知道一定低於門檻
    return dist > max ? Math.min(1 - dist / maxLen, threshold - 0.01) : 1 - dist / maxLen;
  }
  return 1 - levenshtein(a.compact, b.compact) / maxLen;
}

/** 超過這個分數就算「很像」，不默默新建。 */
export const SIMILAR_THRESHOLD = 0.8;

export type SimilarParty = { id: number; name: string; score: number; via: "name" | "alias" };

/** 從候選裡挑出跟 name 很像的（名稱或別名），分數高的在前，最多 limit 個。 */
export function rankSimilarParties(
  candidates: readonly { id: number; name: string; aliases: readonly string[] }[],
  name: string,
  limit = 5,
): SimilarParty[] {
  const out: SimilarParty[] = [];
  for (const c of candidates) {
    let best: SimilarParty | null = null;
    const nameScore = partySimilarity(name, c.name);
    if (nameScore >= SIMILAR_THRESHOLD) best = { id: c.id, name: c.name, score: nameScore, via: "name" };
    for (const alias of c.aliases) {
      const a = alias.trim().replace(/\*$/, "");
      const s = partySimilarity(name, a);
      if (s >= SIMILAR_THRESHOLD && (!best || s > best.score)) best = { id: c.id, name: c.name, score: s, via: "alias" };
    }
    if (best) out.push({ ...best, score: Math.round(best.score * 100) / 100 });
  }
  return out.sort((x, y) => y.score - x.score || x.id - y.id).slice(0, limit);
}

/**
 * 一整份清單裡兩兩找「很像」（交易對象頁的「可能重複」）。key 只算一次、長度差太多的不算編輯距離，
 * 編輯距離超過門檻就提早停。回傳 id → 跟它很像的其他對象（分數高的在前，最多 limit 個）。
 */
export function similarPartiesWithin(
  candidates: readonly { id: number; name: string; aliases: readonly string[] }[],
  limit = 3,
): Map<number, SimilarParty[]> {
  const keyed = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    nameKey: prepareKey(normalizePartyKey(c.name)),
    aliasKeys: c.aliases.map((a) => prepareKey(normalizePartyKey(a.trim().replace(/\*$/, "")))),
  }));
  const out = new Map<number, SimilarParty[]>();
  for (const p of keyed) {
    const list: SimilarParty[] = [];
    for (const c of keyed) {
      if (c.id === p.id) continue;
      let best: SimilarParty | null = null;
      const nameScore = preparedSimilarity(p.nameKey, c.nameKey, SIMILAR_THRESHOLD);
      if (nameScore >= SIMILAR_THRESHOLD) best = { id: c.id, name: c.name, score: nameScore, via: "name" };
      for (const k of c.aliasKeys) {
        const s = preparedSimilarity(p.nameKey, k, SIMILAR_THRESHOLD);
        if (s >= SIMILAR_THRESHOLD && (!best || s > best.score)) best = { id: c.id, name: c.name, score: s, via: "alias" };
      }
      if (best) list.push({ ...best, score: Math.round(best.score * 100) / 100 });
    }
    if (list.length > 0) out.set(p.id, list.sort((x, y) => y.score - x.score || x.id - y.id).slice(0, limit));
  }
  return out;
}
