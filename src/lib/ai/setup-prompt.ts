import type { Locale } from "@/i18n/config";

/** MCP 用戶端設定裡的 server 名稱。 */
export const MCP_SERVER_KEY = "pathors-internal";

/**
 * 首頁「把你的 AI agent 接上 internal」按鈕複製的設定提示詞。
 * 寫成任何 agent（Claude Code、Cursor、ChatGPT、Claude…）貼進去都能自己照做：
 * 告訴它網址與傳輸方式、各家怎麼加、要使用者走 OAuth，最後用只讀工具確認連上。
 * 語言跟著介面語系。網址是目前組織的固定網址（orgMcpUrl），多組織的人也不會接錯。
 */
export function buildSetupPrompt(opts: {
  locale: Locale;
  mcpUrl: string;
  connectorName: string;
}): string {
  const { mcpUrl, connectorName } = opts;
  const cursorJson = JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: { url: mcpUrl } } }, null, 2);
  const claudeCode = `claude mcp add --transport http ${MCP_SERVER_KEY} ${mcpUrl}`;

  if (opts.locale === "en") {
    return [
      `Please connect yourself to Pathors Internal (our company's bookkeeping system) as an MCP server.`,
      ``,
      `- Name: ${connectorName}`,
      `- URL: ${mcpUrl}`,
      `- Transport: Streamable HTTP. Auth: OAuth 2.1 (discovered automatically from the URL; no API key).`,
      ``,
      `Add it the way your tool does:`,
      `- Claude Code: run \`${claudeCode}\`, then run /mcp and choose Authenticate.`,
      `- Cursor: add this to ~/.cursor/mcp.json (merge into an existing mcpServers if there is one), then enable it in Settings → MCP:`,
      "```json",
      cursorJson,
      "```",
      `- Claude (claude.ai / Desktop): Settings → Connectors → Add custom connector, with the name and URL above.`,
      `- ChatGPT: Settings → Apps & Connectors → Create, paste the URL, authentication OAuth.`,
      `- Anything else that speaks MCP: add a remote (HTTP) server with the URL above.`,
      ``,
      `If you can't change your own settings, give me the exact steps instead.`,
      `When the sign-in page opens, I'll log in with my Internal account and approve access.`,
      `Then confirm it works by calling the read-only tool list_organizations and telling me which organizations you can see.`,
    ].join("\n");
  }

  return [
    `請幫我把 Pathors Internal（公司的帳務系統）接成你的 MCP server。`,
    ``,
    `- 名稱：${connectorName}`,
    `- 網址：${mcpUrl}`,
    `- 傳輸：Streamable HTTP。驗證：OAuth 2.1（從網址自動探索，不需要 API key）。`,
    ``,
    `依你所在的工具加入：`,
    `- Claude Code：執行 \`${claudeCode}\`，再執行 /mcp 選 Authenticate。`,
    `- Cursor：把下面這段加進 ~/.cursor/mcp.json（已經有 mcpServers 就合併進去），再到 Settings → MCP 打開：`,
    "```json",
    cursorJson,
    "```",
    `- Claude（claude.ai／桌面版）：設定 → Connectors → Add custom connector，填上面的名稱與網址。`,
    `- ChatGPT：設定 → 應用程式與連接器 → 建立，貼上網址，驗證選 OAuth。`,
    `- 其他支援 MCP 的工具：新增一個遠端（HTTP）server，網址同上。`,
    ``,
    `如果你沒辦法自己改設定，就把我要做的步驟一條條列給我。`,
    `跳出登入頁時，我會用自己的 Internal 帳號登入並同意授權。`,
    `完成後請呼叫只讀工具 list_organizations，告訴我你看得到哪些組織，確認已經連上。`,
  ].join("\n");
}
