/**
 * Claude.ai 的「新增自訂 connector」深層連結：打開後直接跳出新增視窗，名稱與網址都已填好，
 * 使用者只要按新增、走一次 OAuth 授權就連上了。
 */
export const CLAUDE_CONNECTORS_PAGE = "https://claude.ai/customize/connectors";

export function claudeConnectorUrl({
  name,
  url,
}: Readonly<{ name: string; url: string }>): string {
  const params = new URLSearchParams({
    modal: "add-custom-connector",
    connectorName: name,
    connectorUrl: url,
  });
  return `${CLAUDE_CONNECTORS_PAGE}?${params.toString()}`;
}

/** connector 在 Claude 裡顯示的名稱，一個組織一個，方便同時接好幾間公司時分辨。 */
export function internalConnectorName(orgName: string): string {
  return `Pathors Internal (${orgName})`;
}

/** 固定單一組織的 MCP 網址：`/mcp?org=<slug 或 id>`。 */
export function orgMcpUrl(
  mcpUrl: string,
  org: Readonly<{ id: string; slug: string | null }>,
): string {
  return `${mcpUrl}?org=${org.slug ?? org.id}`;
}
