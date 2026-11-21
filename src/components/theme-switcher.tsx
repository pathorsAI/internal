"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";

import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
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
    (theme === "system" && globalThis.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

// localStorage 當作外部 store：切換時通知訂閱者，別的分頁改了（storage 事件）也會跟上。
const listeners = new Set<() => void>();
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  globalThis.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    globalThis.removeEventListener("storage", onChange);
  };
}

/**
 * 使用者選單裡的主題切換（三個選項直接攤開）：跟系統／亮色／深色。偏好存 localStorage（讀寫都包 try，隱私模式拿不到
 * 就跟系統），第一次繪製前由 app/layout.tsx 的 inline script 先套上，這裡只負責切換。
 */
export function ThemeMenuItems() {
  const t = useTranslations("common.theme");
  // server 與 hydration 時一律當 "system"，掛載後才換成實際偏好，避免 hydration mismatch。
  const theme = useSyncExternalStore<Theme>(subscribe, readTheme, () => "system");

  useEffect(() => {
    applyTheme(theme);
    // 選「跟系統」時，系統主題改了要跟著變。
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  function onSelect(next: Theme) {
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      // 存不了就只套用這一次
      applyTheme(next);
    }
    listeners.forEach((notify) => notify());
  }

  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        {t("label")}
      </DropdownMenuLabel>
      {THEMES.map(({ key, icon: Icon }) => (
        <DropdownMenuItem
          key={key}
          // 選完不關選單：切過去馬上看得到效果，不滿意可以直接再換。
          onSelect={(event) => {
            event.preventDefault();
            onSelect(key);
          }}
        >
          <Icon className="size-4" />
          <span className="flex-1">{t(key)}</span>
          <Check className={cn("size-4", key === theme ? "opacity-100" : "opacity-0")} />
        </DropdownMenuItem>
      ))}
    </>
  );
}
