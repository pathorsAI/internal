"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { setUserLocale } from "@/i18n/actions";
import { LOCALES, locales, type Locale } from "@/i18n/config";
import { LocaleFlag } from "@/components/locale-flag";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHydrated } from "@/hooks/use-hydrated";
import { cn } from "@/lib/utils";

/**
 * 帳號頁面（登入、註冊、忘記／重設密碼）右上角的語言切換。
 *
 * 不用 src/app/public-locale-switcher.tsx：那支吃 landing／法律文件自己那套 CSS 變數
 * （.langsw*），帳號頁面走的是 app 的 Tailwind token。也不用側邊欄那支：它綁在
 * SidebarMenu 上。行為跟兩支一樣 —— 寫 cookie 之後一定要 router.refresh()，翻譯後的
 * markup 是 server 產生的。
 *
 * hydration 之前只畫一顆長得一樣、還沒接上選單的按鈕（不加 disabled，免得 hydration
 * 時從半透明閃成正常）：選單在那之前本來就打不開，而
 * useRouter() 要有 app router 才能呼叫 —— 帳號頁面的測試是直接 renderToString
 * （src/__tests__/server-rendered-forms.tsx），沒有 router 可用，也刻意不 mock
 * next/navigation（mock.module 是整個 test process 共用的）。
 */
export function AuthLocaleSwitcher() {
  const hydrated = useHydrated();
  return hydrated ? <LocaleMenu /> : <LocaleTrigger />;
}

function LocaleTrigger({
  pending = false,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  const t = useTranslations("common.locale");
  const active = useLocale() as Locale;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      title={t("label")}
      {...props}
      className={cn("gap-1.5 text-muted-foreground", pending && "opacity-60", props.className)}
    >
      <Languages aria-hidden="true" />
      <span>{LOCALES[active].label}</span>
    </Button>
  );
}

function LocaleMenu() {
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSelect(locale: Locale) {
    if (locale === active) return;
    startTransition(async () => {
      await setUserLocale(locale);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <LocaleTrigger pending={pending} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {locales.map((locale) => (
          <DropdownMenuItem key={locale} lang={locale} onSelect={() => onSelect(locale)}>
            <Check className={cn("size-4", locale === active ? "opacity-100" : "opacity-0")} />
            <LocaleFlag locale={locale} className="size-4 shrink-0" />
            {LOCALES[locale].label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
