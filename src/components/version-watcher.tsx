"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

/** 這份 client 是哪一版（build 時寫入，見 next.config.ts）。 */
const CLIENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? null;
const CHECK_EVERY_MS = 5 * 60_000;
/** 切回分頁時，距離上次檢查至少這麼久才再問一次，避免來回切分頁一直打 API。 */
const MIN_GAP_MS = 30_000;
const TOAST_ID = "new-version";

/** 舊版的 JS chunk 已經不在伺服器上（部署後還開著舊頁面再換頁）時，瀏覽器丟的錯誤。 */
export function isChunkLoadError(e: unknown): boolean {
  if (typeof e === "string") return CHUNK_MESSAGE.test(e);
  if (!e || typeof e !== "object") return false;
  const { name, message } = e as { name?: unknown; message?: unknown };
  return name === "ChunkLoadError" || (typeof message === "string" && CHUNK_MESSAGE.test(message));
}

const CHUNK_MESSAGE =
  /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

/** 「有新版本」提示。版本比對與 chunk 錯誤都走這裡，同一時間只會有一則。 */
let shown = false;
let labels: { message: string; action: string } | null = null;

export function showNewVersionPrompt() {
  if (shown || !labels) return;
  shown = true;
  toast.info(labels.message, {
    id: TOAST_ID,
    // 常駐：不自動消失、不能滑掉。舊頁面繼續用遲早會壞，只留「重新整理」一條路。
    duration: Number.POSITIVE_INFINITY,
    dismissible: false,
    action: { label: labels.action, onClick: () => globalThis.location.reload() },
  });
}

/**
 * 部署新版之後，還開著舊頁面的人會在右下角看到常駐的「有新版本」提示，按「重新整理」就 reload。
 * 每 5 分鐘、以及切回分頁時問一次 /api/version；舊版 chunk 載入失敗時直接跳同一個提示。
 */
export function VersionWatcher() {
  const t = useTranslations("common.newVersion");

  useEffect(() => {
    labels = { message: t("message"), action: t("reload") };
  }, [t]);

  useEffect(() => {
    if (!CLIENT_VERSION) return;
    let last = 0;
    let alive = true;

    async function check() {
      if (shown || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const body: { version?: string | null } = await res.json();
        const version = body.version;
        if (alive && version && version !== CLIENT_VERSION) showNewVersionPrompt();
      } catch {
        // 離線或伺服器正在換版：下一輪再問
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onError = (e: ErrorEvent) => {
      if (isChunkLoadError(e.error ?? e.message)) showNewVersionPrompt();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) showNewVersionPrompt();
    };

    const timer = globalThis.setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    globalThis.addEventListener("focus", onVisible);
    globalThis.addEventListener("error", onError);
    globalThis.addEventListener("unhandledrejection", onRejection);
    return () => {
      alive = false;
      globalThis.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      globalThis.removeEventListener("focus", onVisible);
      globalThis.removeEventListener("error", onError);
      globalThis.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
