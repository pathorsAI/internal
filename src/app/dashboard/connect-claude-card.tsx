"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { AddToClaudeButton } from "@/components/add-to-claude-button";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";

const DISMISSED_KEY = "pathors.connectClaude.dismissed.v1";

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === "1";
  } catch {
    // 儲存空間讀不到（無痕、被封鎖）就照常顯示，不要讓首頁壞掉
    return false;
  }
}

/**
 * 首頁的「接上 Claude」提示卡：關掉之後記在 localStorage 不再出現。
 * 有目前組織的 connector 就直接開 claude.ai 預填視窗，沒有就導去 MCP 設定頁。
 */
export function ConnectClaudeCard({
  connector,
}: Readonly<{ connector: { name: string; url: string } | null }>) {
  const t = useTranslations("dashboard");
  // 伺服器端與 hydrate 前讀不到 localStorage，先不畫，避免已關掉的人看到閃一下
  const hydrated = useHydrated();
  const [closed, setClosed] = useState(false);

  if (!hydrated || closed || readDismissed()) return null;

  function dismiss() {
    setClosed(true);
    try {
      globalThis.localStorage?.setItem(DISMISSED_KEY, "1");
    } catch {
      // 存不了就只在這次關掉
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{t("connectClaude.title")}</p>
        <p className="text-xs text-muted-foreground">{t("connectClaude.body")}</p>
      </div>
      <div className="flex items-center gap-2">
        {connector ? (
          <AddToClaudeButton name={connector.name} url={connector.url} />
        ) : (
          <AddToClaudeButton href="/dashboard/settings/mcp" />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={dismiss}
          aria-label={t("connectClaude.dismiss")}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
