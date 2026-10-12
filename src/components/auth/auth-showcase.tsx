"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 帳號頁面右半邊的產品展示：深藍底、三張輪播，每張是一句標題加一張毛玻璃卡片裡的
 * 產品畫面示意（全用 div 拼，不載圖）。
 *
 * 不管 app 是淺色還是深色主題，這塊都是深色 —— 它是一張「海報」，不是介面的一部分，
 * 所以顏色直接寫死，不吃 bg-background 那組 token。
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

/** 深藍底：近黑的海軍藍打底，疊上幾團 primary（#1e9df1）與偏靛的光暈。 */
const PANEL_BACKGROUND = [
  "radial-gradient(110% 75% at 88% -5%, rgba(30,157,241,0.55) 0%, rgba(30,157,241,0) 58%)",
  "radial-gradient(85% 65% at -5% 105%, rgba(41,71,240,0.42) 0%, rgba(41,71,240,0) 60%)",
  "radial-gradient(55% 45% at 50% 58%, rgba(30,157,241,0.16) 0%, rgba(30,157,241,0) 72%)",
  "linear-gradient(180deg, #071327 0%, #030915 100%)",
].join(", ");

const DOT_GRID: React.CSSProperties = {
  backgroundImage: "radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)",
  backgroundSize: "22px 22px",
  maskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, #000 25%, transparent 80%)",
  WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, #000 25%, transparent 80%)",
};

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
        "relative isolate flex flex-col items-center justify-center overflow-hidden rounded-[28px] px-10 py-12 text-white ring-1 ring-white/10 ring-inset",
        className,
      )}
      style={{ backgroundImage: PANEL_BACKGROUND }}
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
                <h2 className="text-[30px] leading-[1.2] font-semibold tracking-tight text-balance text-white">
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
              className="group flex h-6 flex-1 cursor-pointer items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <span className="block h-[3px] w-full overflow-hidden rounded-full bg-white/20 transition-colors group-hover:bg-white/30">
                {i < active && <span className="block h-full w-full bg-white/70" />}
                {i === active && (
                  // 每換一張，這條 span 都是在另一顆按鈕裡新掛上去的，動畫自然從頭跑。
                  <span
                    className="block h-full w-full origin-left bg-white motion-safe:animate-[auth-showcase-progress_5s_linear_forwards]"
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

/** 點陣與斜向光束。純裝飾。 */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute inset-0" style={DOT_GRID} />
      <div className="absolute -top-1/3 left-[12%] h-[160%] w-28 rotate-[28deg] bg-linear-to-b from-transparent via-sky-400/25 to-transparent blur-2xl" />
      <div className="absolute -top-1/3 left-[48%] h-[160%] w-14 rotate-[28deg] bg-linear-to-b from-transparent via-sky-300/20 to-transparent blur-xl" />
      <div className="absolute -top-1/3 right-[6%] h-[160%] w-40 rotate-[28deg] bg-linear-to-b from-transparent via-blue-500/20 to-transparent blur-3xl" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-[#030915]/80 to-transparent" />
    </div>
  );
}

function GlassCard({ className, children }: Readonly<{ className?: string; children: React.ReactNode }>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-2xl border border-white/15 bg-white/[0.07] p-4 shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)] backdrop-blur-xl",
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
      <span className="text-[13px] font-semibold text-white/90">{title}</span>
      {meta}
    </div>
  );
}

const WindowDots = (
  <span className="flex gap-1">
    <span className="size-1.5 rounded-full bg-white/25" />
    <span className="size-1.5 rounded-full bg-white/25" />
    <span className="size-1.5 rounded-full bg-white/25" />
  </span>
);

type BillingStatus = "due" | "billed" | "overdue" | "paid";

const STATUS_STYLE: Record<BillingStatus, string> = {
  due: "bg-amber-400/15 text-amber-200 ring-amber-300/30",
  billed: "bg-sky-400/15 text-sky-200 ring-sky-300/30",
  overdue: "bg-rose-400/15 text-rose-200 ring-rose-300/30",
  paid: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30",
};

const BILLING_ROWS: readonly {
  project: string;
  stage: "phase1" | "phase2" | "monthly" | "final";
  amount: string;
  status: BillingStatus;
  tile: string;
}[] = [
  { project: "Verdant Biosciences", stage: "phase2", amount: "NT$360,000", status: "due", tile: "bg-emerald-500" },
  { project: "Morningside Creative", stage: "monthly", amount: "NT$40,000", status: "billed", tile: "bg-amber-500" },
  { project: "Northwind Logistics", stage: "final", amount: "NT$120,000", status: "overdue", tile: "bg-sky-500" },
  { project: "Harbor & Pine", stage: "phase1", amount: "NT$80,000", status: "paid", tile: "bg-violet-500" },
];

function BillingMock() {
  const t = useTranslations("auth.showcase.billing");
  return (
    <>
      <MockHeader title={t("title")} meta={WindowDots} />
      <ul className="divide-y divide-white/[0.06]">
        {BILLING_ROWS.map((row) => (
          <li key={row.project} className="flex items-center gap-3 px-1 py-2.5">
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg text-[12px] font-semibold text-white/95",
                row.tile,
              )}
            >
              {row.project.charAt(0)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-white">{row.project}</span>
              <span className="block text-[12px] text-white/55">{t(`stage.${row.stage}`)}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              <span className="font-mono text-[12.5px] text-white/85 tabular-nums">{row.amount}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium ring-1 ring-inset",
                  STATUS_STYLE[row.status],
                )}
              >
                {t(`status.${row.status}`)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * 由深到淺的 primary 藍，金額越大的那條越深。廠商名稱是專有名詞、不翻譯；
 * 「辦公室租金」「其他」才查字典（labelKey）。
 */
const SPENDING_ROWS: readonly ({ amount: number; shade: string } & (
  | { name: string; labelKey?: never }
  | { name?: never; labelKey: "officeRent" | "other" }
))[] = [
  { name: "AWS", amount: 182_400, shade: "#1e9df1" },
  { name: "Google Workspace", amount: 64_800, shade: "#47b0f4" },
  { labelKey: "officeRent", amount: 54_000, shade: "#6fc1f6" },
  { name: "Figma", amount: 21_600, shade: "#bfe3fb" },
  { labelKey: "other", amount: 38_200, shade: "#97d2f9" },
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
              <span className="truncate text-white/85">
                {row.labelKey ? t(row.labelKey) : row.name}
              </span>
              <span className="font-mono text-white/75 tabular-nums">
                NT${row.amount.toLocaleString("en-US")}
              </span>
            </span>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(row.amount / SPENDING_MAX) * 100}%`, backgroundColor: row.shade }}
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
          <span className="grid size-6 place-items-center rounded-md bg-[#1e9df1]/25 text-sky-200">
            <Sparkles className="size-3.5" />
          </span>
        }
      />
      <ul className="flex flex-col gap-2 px-1 pt-1 pb-0.5">
        {STATEMENT_MESSAGES.map((message) => (
          <li
            key={message.key}
            className={cn(
              "max-w-[82%] rounded-2xl px-3 py-2 text-[12.5px] leading-snug",
              message.from === "user"
                ? "self-end rounded-br-md bg-[#1e9df1] text-white"
                : "self-start rounded-bl-md bg-white/10 text-white/85",
            )}
          >
            {t(message.key)}
          </li>
        ))}
      </ul>
    </>
  );
}
