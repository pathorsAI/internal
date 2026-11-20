"use client";

import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "@/lib/currency";

/**
 * 大數字從 0 滾到值（600ms，只在第一次出現時跑一次）。之後值變了直接換，不再滾 ——
 * 重新整理資料時數字一直跳會很吵。系統開了「減少動態效果」就直接顯示。
 * 給 currency 就用 formatCurrency，否則當整數加千分位。
 */
export function CountUp({
  value,
  currency,
  suffix = "",
  className,
}: Readonly<{ value: number; currency?: string; suffix?: string; className?: string }>) {
  const [shown, setShown] = useState(value);
  const played = useRef(false);

  useEffect(() => {
    if (played.current) {
      setShown(value);
      return;
    }
    played.current = true;
    if (
      typeof window === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      value === 0
    ) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const DURATION = 600;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(p < 1 ? Math.round(value * eased) : value);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    setShown(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  const text = currency
    ? formatCurrency(shown, currency)
    : new Intl.NumberFormat("en-US").format(shown);
  return (
    <span className={className} suppressHydrationWarning>
      {text}
      {suffix}
    </span>
  );
}
