/**
 * 這個部署對外的 base URL，同時也是 OAuth 的 issuer。
 *
 * 尾端的斜線要去掉，否則像 `${base}/mcp` 這種串接會生出 `//mcp`，而 OAuth 的
 * `resource` 是逐字比對的字串 —— 多一個斜線，client 回傳的值就對不起來。
 *
 * 刻意不用 `/\/+$/` 這種正規表示式：`+` 加上錨點會產生會回溯的比對，Sonar 的
 * S5852 會把它標成 DoS hotspot。這裡用線性掃描，行為一樣但沒有回溯可言。
 *
 * 放在獨立的 leaf module，是因為 src/lib/auth.ts 與 src/lib/mcp/handler.ts 兩邊
 * 都要用；讓 auth.ts 去 import handler.ts 會把整個 tool graph 與 DB 層拖進來。
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

const DEV_ORIGIN = "http://localhost:3000";

/**
 * `BETTER_AUTH_URL`（去掉尾端斜線）。未設定時退回本機開發網址 —— 不寫死任何一個
 * 正式站：自架的人忘了設，寧可 OAuth issuer / MCP resource 明顯錯成 localhost，
 * 也不要默默宣稱自己是別人的網域。正式環境一定要設 BETTER_AUTH_URL。
 */
export function publicBaseUrl(): string {
  const v = process.env.BETTER_AUTH_URL?.trim();
  return trimTrailingSlashes(v || DEV_ORIGIN);
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * better-auth 的 trustedOrigins（CSRF / origin 檢查），也是 /mcp 允許的「自家」瀏覽器 origin：
 * - BETTER_AUTH_URL 的 origin
 * - TRUSTED_ORIGINS：逗號分隔的額外 origin（例如自訂網域 + *.workers.dev 兩個都要能登入）
 * - http://localhost:3000：只在 NODE_ENV !== "production" 時加入。正式環境信任 localhost
 *   等於讓任何在使用者電腦上跑 3000 port 的東西都能過 origin 檢查。
 * 解析不了的值直接丟掉（不讓一個打錯的設定變成「信任任意字串」）。
 */
export function trustedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const out = new Set<string>();
  const base = env.BETTER_AUTH_URL?.trim();
  if (base) {
    const o = originOf(base);
    if (o) out.add(o);
  }
  for (const raw of (env.TRUSTED_ORIGINS ?? "").split(",")) {
    const o = raw.trim() ? originOf(raw.trim()) : null;
    if (o) out.add(o);
  }
  if (env.NODE_ENV !== "production") out.add(DEV_ORIGIN);
  return [...out];
}
