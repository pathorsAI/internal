"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

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

type Theme = "system" | "light" | "dark";
const THEMES: { key: Theme; icon: typeof Sun }[] = [
  { key: "system", icon: Monitor },
  { key: "light", icon: Sun },
  { key: "dark", icon: Moon },
];

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * 側欄的主題切換：跟系統／亮色／深色。偏好存 localStorage（讀寫都包 try，隱私模式拿不到
 * 就跟系統），第一次繪製前由 app/layout.tsx 的 inline script 先套上，這裡只負責切換。
 */
export function ThemeSwitcher() {
  const t = useTranslations("common.theme");
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    setTheme(readTheme());
    // 選「跟系統」時，系統主題改了要跟著變。
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function onSelect(next: Theme) {
    setTheme(next);
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      // 存不了就只在這次瀏覽生效
    }
    applyTheme(next);
  }

  const ActiveIcon = THEMES.find((x) => x.key === theme)?.icon ?? Monitor;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton title={t("label")}>
              <ActiveIcon />
              <span>{t(theme)}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="min-w-40">
            {THEMES.map(({ key, icon: Icon }) => (
              <DropdownMenuItem key={key} onSelect={() => onSelect(key)}>
                <Check className={cn("size-4", key === theme ? "opacity-100" : "opacity-0")} />
                <Icon className="size-4" />
                {t(key)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
