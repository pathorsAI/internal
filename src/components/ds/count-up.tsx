"use client";

import { useEffect, useRef } from "react";
import { formatCurrency } from "@/lib/currency";

function format(value: number, currency: string | undefined, suffix: string) {
  const text = currency
    ? formatCurrency(value, currency)
    : new Intl.NumberFormat("en-US").format(value);
  return `${text}${suffix}`;
}

/**
 * 大數字從 0 滾到值（600ms，只在第一次出現時跑一次）。之後值變了直接換，不再滾 ——
 * 重新整理資料時數字一直跳會很吵。系統開了「減少動態效果」就直接顯示。
 * 給 currency 就用 formatCurrency，否則當整數加千分位。
 *
 * React 渲染出來的永遠是最終值（SSR、無 JS、螢幕閱讀器看到的都是對的）；滾動只是掛載後
 * 直接改這個 span 的文字，不經過 state，所以不會多觸發 render。
 */
export function CountUp({
  value,
  currency,
  suffix = "",
  className,
}: Readonly<{ value: number; currency?: string; suffix?: string; className?: string }>) {
  const ref = useRef<HTMLSpanElement>(null);
  const played = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || played.current) return;
    played.current = true;
    if (value === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const start = performance.now();
    const DURATION = 600;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(p < 1 ? Math.round(value * eased) : value, currency, suffix);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = format(value, currency, suffix);
    };
  }, [value, currency, suffix]);

  return (
    <span ref={ref} className={className}>
      {format(value, currency, suffix)}
    </span>
  );
}
