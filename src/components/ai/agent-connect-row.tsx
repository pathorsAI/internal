"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { claudeConnectorUrl } from "@/lib/claude-connector";
import { ClaudeLogo, CursorLogo, OpenAILogo } from "./brand-logos";

/** MCP 用戶端設定裡的 server 名稱。 */
const SERVER_KEY = "pathors-internal";

export function cursorConfig(url: string): string {
  return JSON.stringify({ mcpServers: { [SERVER_KEY]: { url } } }, null, 2);
}

export function claudeCodeCommand(url: string): string {
  return `claude mcp add --transport http ${SERVER_KEY} ${url}`;
}

/**
 * 首頁輸入框下面常駐的外部 agent 列（取代原本可關閉的「接上 Claude」卡片）。
 * Claude 直接開 claude.ai 的預填 connector 視窗；ChatGPT／Cursor／Claude Code 複製
 * 對應的 MCP 網址、設定或指令並跳 toast 說下一步。connector 為 null（找不到目前組織）
 * 時全部導去 MCP 設定頁。
 */
export function AgentConnectRow({
  connector,
}: Readonly<{ connector: { name: string; url: string } | null }>) {
  const t = useTranslations("ai.connect");

  async function copy(text: string, title: string, description: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(title, { description });
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  const item = "h-8 gap-1.5 px-2.5 text-xs font-medium";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-xs text-muted-foreground">{t("label")}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {connector ? (
          <>
            <Button asChild variant="outline" size="sm" className={item}>
              <a href={claudeConnectorUrl(connector)} target="_blank" rel="noopener noreferrer">
                <ClaudeLogo className="size-3.5 text-[#D97757]" />
                {t("claude")}
              </a>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={item}
              onClick={() => copy(connector.url, t("copiedUrl"), t("copiedUrlHint"))}
            >
              <OpenAILogo className="size-3.5" />
              {t("chatgpt")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={item}
              onClick={() => copy(cursorConfig(connector.url), t("copiedCursor"), t("copiedCursorHint"))}
            >
              <CursorLogo className="size-3.5" />
              {t("cursor")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={item}
              onClick={() => copy(claudeCodeCommand(connector.url), t("copiedCommand"), t("copiedCommandHint"))}
            >
              <ClaudeLogo className="size-3.5 text-[#D97757]" />
              {t("claudeCode")}
            </Button>
          </>
        ) : null}
        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground">
          <Link href="/dashboard/settings/mcp">{t("more")}</Link>
        </Button>
      </div>
    </div>
  );
}
