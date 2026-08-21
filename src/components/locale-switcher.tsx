"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { setUserLocale } from "@/i18n/actions";
import { locales, localeLabels, type Locale } from "@/i18n/config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export function LocaleSwitcher() {
  const t = useTranslations("common.locale");
  const active = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onSelect(locale: Locale) {
    if (locale === active) return;
    startTransition(async () => {
      await setUserLocale(locale);
      // Server components hold the translated markup, so the tree must re-render
      // from the server for the new cookie to take effect.
      router.refresh();
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              title={t("label")}
              className={cn(pending && "opacity-60")}
            >
              <Languages className="size-4 text-muted-foreground" />
              <span>{localeLabels[active]}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="min-w-40">
            {locales.map((locale) => (
              <DropdownMenuItem key={locale} onSelect={() => onSelect(locale)}>
                <Check
                  className={cn(
                    "size-4",
                    locale === active ? "opacity-100" : "opacity-0",
                  )}
                />
                {localeLabels[locale]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
