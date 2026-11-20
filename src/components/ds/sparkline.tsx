import { cn } from "@/lib/utils";

/**
 * 統計數字底下的走勢線：一條會畫出來的細線，末端一顆亮點。純 SVG，server / client 都能用。
 * 少於兩個點就不畫（沒有「走勢」可言）。
 */
export function Sparkline({
  data,
  className,
  tone = "primary",
}: Readonly<{
  data: readonly number[];
  className?: string;
  tone?: "primary" | "income" | "risk";
}>) {
  const points = data.filter((n) => Number.isFinite(n));
  if (points.length < 2) return null;

  const W = 200;
  const H = 28;
  const PAD = 3;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = PAD + (1 - (v - min) / span) * (H - PAD * 2);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const lastY = xy[xy.length - 1][1];
  const spark =
    tone === "income" ? "var(--income)" : tone === "risk" ? "var(--destructive)" : undefined;

  return (
    <div
      aria-hidden
      className={cn("sparkline relative h-7 w-full", className)}
      style={spark ? ({ "--spark": spark } as React.CSSProperties) : undefined}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block size-full overflow-visible"
      >
        <path className="spark-area" d={area} />
        <path className="spark-line" d={line} pathLength={400} />
      </svg>
      <span
        className="spark-dot absolute right-0 size-[5px] translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ top: `${(lastY / H) * 100}%` }}
      />
    </div>
  );
}
