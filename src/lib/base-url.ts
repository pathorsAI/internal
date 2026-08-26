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

/** `BETTER_AUTH_URL`（去掉尾端斜線），未設定時退回正式站網址。 */
export function publicBaseUrl(): string {
  return trimTrailingSlashes(process.env.BETTER_AUTH_URL ?? "https://internal.pathors.com");
}
