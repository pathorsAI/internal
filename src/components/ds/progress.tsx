import { cn } from "@/lib/utils";

/**
 * 亮頭進度條：合約收款、訂閱期數、對帳進度。收齊（>= max）變綠、超收變紅。
 * 載入中不要用這個，用 Skeleton。
 */
export function Progress({
  value,
  max,
  className,
  label,
}: Readonly<{ value: number; max: number; className?: string; label?: string }>) {
  const ratio = max > 0 ? value / max : 0;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  const state = ratio > 1.0001 ? "over" : ratio >= 0.9999 ? "done" : pct <= 0 ? "empty" : "partial";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      data-state={state}
      className={cn("ds-progress w-full", className)}
      style={{ "--w": `${pct}%` } as React.CSSProperties}
    >
      <i />
    </div>
  );
}
