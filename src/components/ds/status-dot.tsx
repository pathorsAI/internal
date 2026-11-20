import { cn } from "@/lib/utils";

type Tone = "neutral" | "primary" | "income" | "warning" | "risk";

const toneVar: Record<Tone, string | undefined> = {
  neutral: undefined,
  primary: "var(--primary)",
  income: "var(--income)",
  warning: "var(--warning)",
  risk: "var(--destructive)",
};

/**
 * 狀態色點。一般狀態用靜止的點；pulse（向外擴散的紅圈）只給「逾期」與「同步失敗」，
 * 到處都在呼吸就沒有人會看了。
 */
export function StatusDot({
  tone = "neutral",
  pulse = false,
  className,
}: Readonly<{ tone?: Tone; pulse?: boolean; className?: string }>) {
  const dot = toneVar[tone];
  return (
    <span
      aria-hidden
      data-pulse={pulse || undefined}
      className={cn("status-dot", className)}
      style={dot ? ({ "--dot": dot } as React.CSSProperties) : undefined}
    />
  );
}

/** 淡底＋色點的狀態標籤：取代黑底／實心色的膠囊。 */
export function StatusTag({
  tone = "neutral",
  pulse = false,
  className,
  children,
}: Readonly<{ tone?: Tone; pulse?: boolean; className?: string; children: React.ReactNode }>) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border bg-card px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground/85",
        className,
      )}
    >
      <StatusDot tone={tone} pulse={pulse} />
      {children}
    </span>
  );
}
