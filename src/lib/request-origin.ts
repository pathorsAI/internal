/** 從請求 header 推出對外的 origin（`https://internal.pathors.com` 這種），給要顯示完整網址的頁面用。 */
export function requestOrigin(h: Pick<Headers, "get">): string {
  const host = h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
