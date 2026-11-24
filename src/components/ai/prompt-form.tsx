"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 首頁輸入框與 ⌘K 共用的輸入：送出後帶著問題跳到 /dashboard/ai 開一段新對話。
 *
 * 問題不放進網址（帳務問題會留在瀏覽器歷史與伺服器 log）：先寫進 sessionStorage，
 * AI 助理頁一打開就讀走、刪掉、送出。sessionStorage 不能用（無痕被封鎖）才退回 ?q=。
 */
const HANDOFF_KEY = "pathors.ai.handoff.v1";

export type Handoff = { q: string; page: string | null };

export function stashQuestion(h: Handoff): boolean {
  try {
    globalThis.sessionStorage?.setItem(HANDOFF_KEY, JSON.stringify(h));
    return globalThis.sessionStorage?.getItem(HANDOFF_KEY) !== null;
  } catch {
    return false;
  }
}

/** 讀走並刪掉首頁交過來的問題。 */
export function takeStashedQuestion(): Handoff | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(HANDOFF_KEY);
    if (!raw) return null;
    globalThis.sessionStorage?.removeItem(HANDOFF_KEY);
    const v = JSON.parse(raw) as Partial<Handoff>;
    return typeof v.q === "string" && v.q.trim()
      ? { q: v.q, page: typeof v.page === "string" ? v.page : null }
      : null;
  } catch {
    return null;
  }
}

export function useAskAssistant() {
  const router = useRouter();
  const pathname = usePathname();
  return (q: string) => {
    const question = q.trim();
    if (!question) return;
    if (stashQuestion({ q: question, page: pathname })) {
      router.push("/dashboard/ai?new=1");
    } else {
      router.push(`/dashboard/ai?q=${encodeURIComponent(question)}`);
    }
  };
}

export function AiPromptForm({
  size = "lg",
  autoFocus,
  onSubmitted,
  className,
}: Readonly<{
  size?: "lg" | "md";
  autoFocus?: boolean;
  onSubmitted?: () => void;
  className?: string;
}>) {
  const t = useTranslations("ai.prompt");
  const ask = useAskAssistant();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(q: string) {
    if (!q.trim()) {
      inputRef.current?.focus();
      return;
    }
    ask(q);
    onSubmitted?.();
  }

  // 前兩個直接問；「記一筆支出」細節要使用者自己補，所以只填進輸入框。
  const suggestions = [
    { label: t("suggestions.unbilled"), fill: false },
    { label: t("suggestions.topSpend"), fill: false },
    { label: t("suggestions.record"), fill: true },
  ];

  function fill(text: string) {
    setValue(`${text} `);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  }

  return (
    <div className={cn("space-y-3", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-card pr-2 pl-4 shadow-xs transition-[box-shadow,border-color] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30",
          size === "lg" ? "h-14" : "h-12",
        )}
      >
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
        <input
          ref={inputRef}
          data-ai-prompt-input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          autoFocus={autoFocus}
          maxLength={4000}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        {size === "lg" ? (
          <kbd className="hidden h-6 items-center rounded-sm border bg-muted px-1.5 font-mono text-xs text-muted-foreground sm:inline-flex">
            ⌘K
          </kbd>
        ) : null}
        <Button type="submit" size="icon-sm" aria-label={t("submit")} disabled={!value.trim()}>
          <ArrowUp className="size-4" />
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <Button
            key={s.label}
            type="button"
            variant="outline"
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
            onClick={() => (s.fill ? fill(s.label) : submit(s.label))}
          >
            {s.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
