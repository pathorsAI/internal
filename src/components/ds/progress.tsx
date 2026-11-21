import { cn } from "@/lib/utils";

type ProgressState = "empty" | "partial" | "done" | "over";

function progressState(ratio: number): ProgressState {
  if (ratio > 1.0001) return "over";
  if (ratio >= 0.9999) return "done";
  if (ratio <= 0) return "empty";
  return "partial";
}

/**
 * 亮頭進度條：合約收款、訂閱期數、對帳進度。收齊（>= max）變綠、超收變紅。
 * 載入中不要用這個，用 Skeleton。
 *
 * 看得到的那條是裝飾（aria-hidden）；語意交給裡面那個視覺上隱藏的原生 <progress>，
 * 螢幕閱讀器讀到的是它。
 */
export function Progress({
  value,
  max,
  className,
  label,
}: Readonly<{ value: number; max: number; className?: string; label?: string }>) {
  const ratio = max > 0 ? value / max : 0;
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return (
    <div
      data-state={progressState(ratio)}
      className={cn("ds-progress w-full", className)}
      style={{ "--w": `${pct}%` } as React.CSSProperties}
    >
      <i aria-hidden />
      <progress className="sr-only" aria-label={label} value={Math.round(pct)} max={100} />
    </div>
  );
}
