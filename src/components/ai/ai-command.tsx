"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AiPromptForm } from "./prompt-form";

/** 頁面上已經有 AI 輸入框（首頁、AI 助理頁）時 ⌘K 直接聚焦它，不另開視窗。 */
function focusInlineInput(): boolean {
  const el = document.querySelector<HTMLElement>("[data-ai-composer], [data-ai-prompt-input]");
  if (!el?.offsetParent) return false;
  el.focus();
  return true;
}

/**
 * 全站 ⌘K（Windows／Linux 為 Ctrl+K）：叫出跟首頁同一個 AI 輸入框，送出後到 /dashboard/ai。
 * 掛在 dashboard layout，所以每一頁都有；問題會帶著目前頁面的路徑當脈絡。
 */
export function AiCommand() {
  const t = useTranslations("ai.prompt");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      if (!open && focusInlineInput()) return;
      setOpen((v) => !v);
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="top-[22%] translate-y-0 gap-3 p-4 sm:max-w-xl">
        <DialogTitle className="text-sm font-medium">{t("heading")}</DialogTitle>
        {open ? <AiPromptForm size="md" autoFocus onSubmitted={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
