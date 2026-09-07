"use client";

import { createContext, useContext, useMemo, useTransition } from "react";
import { cn } from "@/lib/utils";

type RefreshPendingValue = {
  /** 有工作正在跑，而且它引發的 router.refresh() 還沒回來。 */
  pending: boolean;
  /** 把一段「做完會 router.refresh()」的工作交給共用的 transition 跑。 */
  startPending: (task: () => Promise<void> | void) => void;
};

// 預設值是直接執行、永不 pending，所以就算元件被放在 Provider 外面也不會爆。
const RefreshPendingContext = createContext<RefreshPendingValue>({
  pending: false,
  startPending: (task) => void task(),
});

/**
 * 「畫面正在等 server 重新渲染」的共享狀態。
 *
 * 切換組織時 router.refresh() 會把每一頁 force-dynamic 的 server component 重跑一次，
 * 期間畫面上的資料仍是舊組織的，但看起來完全正常 —— 使用者只會覺得「按了沒反應」。
 *
 * transition 開在這裡（而不是各自在呼叫端）是關鍵：router.refresh() 要在 transition 裡
 * 呼叫，isPending 才會一路撐到 server 回來為止。呼叫端自己開 transition 的話，只能在
 * 送出 refresh() 的當下就把旗標關掉 —— 那正好是等待開始的時間點。
 */
export function RefreshPendingProvider({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [pending, startTransition] = useTransition();
  const value = useMemo<RefreshPendingValue>(
    () => ({ pending, startPending: (task) => startTransition(task) }),
    [pending],
  );
  return (
    <RefreshPendingContext.Provider value={value}>
      {children}
    </RefreshPendingContext.Provider>
  );
}

export function useRefreshPending() {
  return useContext(RefreshPendingContext);
}

/**
 * 主內容區的外框：pending 時壓暗並擋掉點擊，同時在最上緣顯示一條不定量進度條。
 * 直接算成 <main>，這樣 layout 原本的 flex 版面不會多包一層而跑掉。
 */
export function RefreshPendingOverlay({
  className,
  children,
}: Readonly<{ className?: string; children: React.ReactNode }>) {
  const { pending } = useRefreshPending();
  return (
    <>
      {pending ? (
        <div
          role="progressbar"
          aria-busy="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/20"
        >
          <div className="h-full w-1/3 animate-[refresh-bar_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
      ) : null}
      <main
        className={cn(
          className,
          "transition-opacity duration-200",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {children}
      </main>
    </>
  );
}
