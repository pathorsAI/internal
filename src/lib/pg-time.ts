/**
 * drizzle 的 timestamp(mode: 'string') 讀回來是 Postgres 的文字格式，例如
 * "2026-11-25 03:18:09.564574+08"：中間是空白、時區只有小時。不同 JS 引擎的 Date.parse
 * 對這種格式不一定吃（V8 與 JSC 行為不同），所以先轉成 ISO 8601 再解析。
 * 已經是 ISO 的字串原樣解析。解析不了回 NaN。
 */
export function parsePgTimestamp(s: string | null | undefined): number {
  if (!s) return Number.NaN;
  const iso = s
    .trim()
    .replace(" ", "T")
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Date.parse(s) : t;
}
