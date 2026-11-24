"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHydrated } from "@/hooks/use-hydrated";
import { isLocale } from "@/i18n/config";
import { buildSetupPrompt } from "@/lib/ai/setup-prompt";
import { ClaudeLogo, CursorLogo, OpenAILogo } from "./brand-logos";

const DISMISSED_KEY = "pathors.agentOnboard.dismissed.v1";

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === "1";
  } catch {
    // 讀不到儲存空間（無痕、被封鎖）就照常顯示
    return false;
  }
}

/**
 * 首頁輸入框上方的「把你的 AI agent 接上 internal」膠囊按鈕（照 Cloudflare dashboard 的做法）：
 * 一顆按鈕只做一件事——複製一段設定提示詞，使用者貼進自己的 AI 工具，由 agent 自己完成設定。
 * 後面那排 logo 只是告訴人「這些都能用」，不能各自點。可以關掉（記在 localStorage）；
 * 關掉之後 MCP 設定頁一樣找得到連線方式。
 */
export function AgentOnboardPill({
  connector,
}: Readonly<{ connector: { name: string; url: string } }>) {
  const t = useTranslations("ai.onboard");
  const rawLocale = useLocale();
  const locale = isLocale(rawLocale) ? rawLocale : "zh-TW";
  // 伺服器端讀不到 localStorage：一律先畫出來（大多數人沒關掉，第一屏就是最終版面、不會跳），
  // hydrate 後才確認是否已關掉；關掉過的人只會在 hydrate 那一刻收起。
  const hydrated = useHydrated();
  const [closed, setClosed] = useState(false);

  if (closed || (hydrated && readDismissed())) return null;

  async function copy() {
    const prompt = buildSetupPrompt({ locale, mcpUrl: connector.url, connectorName: connector.name });
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  function dismiss() {
    setClosed(true);
    try {
      globalThis.localStorage?.setItem(DISMISSED_KEY, "1");
    } catch {
      // 存不了就只在這次關掉
    }
  }

  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center rounded-full border bg-card shadow-xs">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={copy}
              className="inline-flex h-8 items-center gap-2 rounded-l-full pr-2 pl-3.5 text-xs font-medium transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {t("label")}
              <span className="flex items-center gap-1.5 text-muted-foreground" aria-hidden>
                <ClaudeLogo className="size-3.5" />
                <OpenAILogo className="size-3.5" />
                <CursorLogo className="size-3.5" />
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("tooltip")}</TooltipContent>
        </Tooltip>
        <span className="h-4 w-px bg-border" aria-hidden />
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("dismiss")}
          className="inline-flex size-8 items-center justify-center rounded-r-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
