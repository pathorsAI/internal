"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { StatusTag } from "@/components/ds/status-dot";
import { cn } from "@/lib/utils";

/**
 * 帳號頁面右半邊的產品展示：方格紙底（.grid-paper，見 globals.css 的「配件」）加一團
 * 品牌藍的光暈、三張輪播，每張是一句標題加一張卡片裡的產品畫面示意（全用 div 拼，不載圖）。
 *
 * 顏色全走 app 的 token（bg-card、text-muted-foreground、bg-primary…），所以跟著淺色／
 * 深色主題一起切換，看起來就是產品本身的一角，而不是另一張海報。
 *
 * 輪播的計時器就是進度條本身的 CSS 動畫：目前那條填滿（animationend）就換下一張。
 * 好處是暫停只要把 animation-play-state 設成 paused（滑鼠移上來、或焦點在裡面），
 * 回來時從原本的進度接著跑，不必自己記剩幾毫秒；而 prefers-reduced-motion 時
 * motion-reduce:animate-none 把動畫拿掉，animationend 永遠不會觸發，自然就不會自動
 * 換張 —— 只剩點進度條切換。動畫的 keyframes 在 globals.css（auth-showcase-progress），
 * 每張停留的秒數寫在進度條的 class 上（5s）。
 *
 * 焦點只有「鍵盤焦點」（:focus-visible）才暫停：滑鼠點進度條也會讓按鈕拿到焦點，
 * 那種情況若也暫停，滑鼠移開後輪播就停在那裡不動了。
 */

type Slide = "billing" | "spending" | "statement";
const SLIDES: readonly Slide[] = ["billing", "spending", "statement"];

export function AuthShowcase({ className }: Readonly<{ className?: string }>) {
  const t = useTranslations("auth.showcase");
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  return (
    <section
      aria-label={t("label")}
      className={cn(
        "grid-paper flex flex-col items-center justify-center overflow-hidden rounded-xl border border-border-soft bg-muted/50 px-10 py-12 text-foreground",
        className,
      )}
      data-fade="full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(e) => setFocused(e.target.matches(":focus-visible"))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <Backdrop />

      <div className="relative w-full max-w-[440px]">
        <div className="grid">
          {SLIDES.map((slide, i) => {
            const current = i === active;
            return (
              <div
                key={slide}
                aria-hidden={!current}
                inert={!current}
                className={cn(
                  "col-start-1 row-start-1 transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none",
                  current ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
                )}
              >
                <h2 className="text-[28px] leading-[1.2] font-semibold tracking-tight text-balance">
                  {t(`${slide}.headline`)}
                </h2>
                <GlassCard className="mt-8">
                  {slide === "billing" && <BillingMock />}
                  {slide === "spending" && <SpendingMock />}
                  {slide === "statement" && <StatementMock />}
                </GlassCard>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex gap-2">
          {SLIDES.map((slide, i) => (
            <button
              key={slide}
              type="button"
              aria-label={t("goTo", { index: i + 1, total: SLIDES.length })}
              aria-current={i === active ? "true" : undefined}
              onClick={() => setActive(i)}
              className="group flex h-6 flex-1 cursor-pointer items-center rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="block h-[3px] w-full overflow-hidden rounded-full bg-foreground/10 transition-colors group-hover:bg-foreground/20">
                {i < active && <span className="block h-full w-full bg-primary/45" />}
                {i === active && (
                  // 每換一張，這條 span 都是在另一顆按鈕裡新掛上去的，動畫自然從頭跑。
                  <span
                    className="block h-full w-full origin-left bg-primary motion-safe:animate-[auth-showcase-progress_5s_linear_forwards]"
                    style={{ animationPlayState: paused ? "paused" : "running" }}
                    onAnimationEnd={() => setActive((i + 1) % SLIDES.length)}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 卡片後面那團品牌藍的光暈（方格紙本身由 .grid-paper 畫）。純裝飾。 */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute top-1/2 left-1/2 h-[560px] w-[680px] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,var(--halo),transparent)]" />
    </div>
  );
}

function GlassCard({ className, children }: Readonly<{ className?: string; children: React.ReactNode }>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-xl border bg-card p-4 shadow-lg",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MockHeader({ title, meta }: Readonly<{ title: string; meta?: React.ReactNode }>) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <span className="text-[13px] font-semibold">{title}</span>
      {meta}
    </div>
  );
}

const WindowDots = (
  <span className="flex gap-1">
    <span className="size-1.5 rounded-full bg-border" />
    <span className="size-1.5 rounded-full bg-border" />
    <span className="size-1.5 rounded-full bg-border" />
  </span>
);

type BillingStatus = "due" | "billed" | "overdue" | "paid";

const STATUS_TONE: Record<BillingStatus, "warning" | "primary" | "risk" | "income"> = {
  due: "warning",
  billed: "primary",
  overdue: "risk",
  paid: "income",
};

const BILLING_ROWS: readonly {
  project: string;
  stage: "phase1" | "phase2" | "monthly" | "final";
  amount: string;
  status: BillingStatus;
}[] = [
  { project: "Verdant Biosciences", stage: "phase2", amount: "NT$360,000", status: "due" },
  { project: "Morningside Creative", stage: "monthly", amount: "NT$40,000", status: "billed" },
  { project: "Northwind Logistics", stage: "final", amount: "NT$120,000", status: "overdue" },
  { project: "Harbor & Pine", stage: "phase1", amount: "NT$80,000", status: "paid" },
];

function BillingMock() {
  const t = useTranslations("auth.showcase.billing");
  return (
    <>
      <MockHeader title={t("title")} meta={WindowDots} />
      <ul className="divide-y divide-border-soft">
        {BILLING_ROWS.map((row) => (
          <li key={row.project} className="flex items-center gap-3 px-1 py-2.5">
            <span
              className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-[12px] font-semibold text-accent-foreground"
            >
              {row.project.charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{row.project}</span>
              <span className="block text-[12px] text-muted-foreground">{t(`stage.${row.stage}`)}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="text-[12.5px] font-medium tabular-nums">{row.amount}</span>
              <StatusTag tone={STATUS_TONE[row.status]} className="text-[11px]">
                {t(`status.${row.status}`)}
              </StatusTag>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * primary 藍由深到淺，金額越大的那條越深（不透明度寫在 shade 上）。廠商名稱是專有名詞、不翻譯；
 * 「辦公室租金」「其他」才查字典（labelKey）。
 */
const SPENDING_ROWS: readonly ({ amount: number; shade: string } & (
  | { name: string; labelKey?: never }
  | { name?: never; labelKey: "officeRent" | "other" }
))[] = [
  { name: "AWS", amount: 182_400, shade: "bg-primary" },
  { name: "Google Workspace", amount: 64_800, shade: "bg-primary/75" },
  { labelKey: "officeRent", amount: 54_000, shade: "bg-primary/60" },
  { name: "Figma", amount: 21_600, shade: "bg-primary/30" },
  { labelKey: "other", amount: 38_200, shade: "bg-primary/45" },
];
const SPENDING_MAX = Math.max(...SPENDING_ROWS.map((row) => row.amount));

function SpendingMock() {
  const t = useTranslations("auth.showcase.spending");
  return (
    <>
      <MockHeader title={t("title")} meta={WindowDots} />
      <ul className="space-y-3 px-1 pt-1 pb-1.5">
        {SPENDING_ROWS.map((row) => (
          <li key={row.name ?? row.labelKey}>
            <span className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="truncate">
                {row.labelKey ? t(row.labelKey) : row.name}
              </span>
              <span className="text-muted-foreground tabular-nums">
                NT${row.amount.toLocaleString("en-US")}
              </span>
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", row.shade)}
                style={{ width: `${(row.amount / SPENDING_MAX) * 100}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const STATEMENT_MESSAGES: readonly { key: "upload" | "read" | "ask" | "answer"; from: "user" | "assistant" }[] = [
  { key: "upload", from: "user" },
  { key: "read", from: "assistant" },
  { key: "ask", from: "assistant" },
  { key: "answer", from: "user" },
];

function StatementMock() {
  const t = useTranslations("auth.showcase.statement");
  return (
    <>
      <MockHeader
        title={t("title")}
        meta={
          <span className="grid size-6 place-items-center rounded-md bg-accent text-accent-foreground">
            <Sparkles className="size-3.5" />
          </span>
        }
      />
      <ul className="flex flex-col gap-2 px-1 pt-1 pb-0.5">
        {STATEMENT_MESSAGES.map((message) => (
          <li
            key={message.key}
            className={cn(
              "max-w-[82%] rounded-xl px-3 py-2 text-[12.5px] leading-snug",
              message.from === "user"
                ? "self-end rounded-br-sm bg-primary text-primary-foreground"
                : "self-start rounded-bl-sm bg-muted text-foreground",
            )}
          >
            {t(message.key)}
          </li>
        ))}
      </ul>
    </>
  );
}
