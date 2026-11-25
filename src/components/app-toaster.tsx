"use client";

import { useSyncExternalStore } from "react";
import { Toaster } from "@/components/ui/sonner";

type Theme = "light" | "dark";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const getTheme = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");
const getServerTheme = (): Theme => "light";

/**
 * 全站唯一的 toast 出口：右下角。
 *
 * shadcn 的 Toaster 用 next-themes 的 useTheme 決定亮暗，但這個 app 沒有 next-themes 的 provider
 * （主題由 layout 的 inline script 切 <html class="dark">），所以它永遠是 "system"：使用者自己選了
 * 亮色或暗色時，toast 會跟頁面相反。這裡照 <html> 的 class 給 theme，切換主題時跟著換。
 * ui/sonner.tsx 保持原樣（見 docs/design-system.md）。
 */
export function AppToaster() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);
  return <Toaster theme={theme} position="bottom-right" />;
}
