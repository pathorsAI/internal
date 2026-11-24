/**
 * 報表列的顯示文字與數字格式。client / server 共用（不碰 hooks）。
 *
 * StatementRow.label 對「不是科目」的列是 i18n key（src/lib/ledger/labels.ts 的 LEDGER_LABEL_KEYS），
 * 翻譯放在 statements.labels.<key>。key 是動態的，typed translator 收不了，所以這裡用寬鬆的型別。
 */
import type { StatementRow } from "@/lib/ledger/types";

export type LooseT = {
  (key: string, values?: Record<string, string | number | Date>): string;
  has(key: string): boolean;
};

/** 把 typed translator 轉成可吃動態 key 的版本（只在 key 來自引擎時用）。 */
export function loose(t: unknown): LooseT {
  return t as LooseT;
}

/** 非科目列翻成 statements.labels.<key>；查不到就原樣顯示（新國家模組漏翻時至少看得到 key）。 */
export function rowLabel(t: LooseT, row: Pick<StatementRow, "kind" | "label" | "glAccountId">): string {
  if (row.kind === "account" && row.glAccountId !== null) return row.label;
  const key = `labels.${row.label}`;
  return t.has(key) ? t(key) : row.label;
}

/** 變動百分比；沒有比較數或比較數為 0 時回 null。 */
export function changeRatio(amount: number, compare: number | null): number | null {
  if (compare === null || Math.abs(compare) < 0.005) return null;
  return (amount - compare) / Math.abs(compare);
}

export function formatPercent(ratio: number | null, locale: string): string {
  if (ratio === null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(ratio);
}

/** 期間的顯示文字。 */
export function periodText(period: { from: string; to: string }): string {
  return period.from === period.to ? period.to : `${period.from} – ${period.to}`;
}

/** 列的樣式：區塊標題、科目、小計、合計（docs/design-system.md：只用 token）。 */
export function rowClass(kind: StatementRow["kind"]): string {
  switch (kind) {
    case "header":
      return "bg-muted/40 hover:bg-muted/40 text-muted-foreground font-medium";
    case "subtotal":
      return "font-medium hover:bg-transparent [&>td]:border-t";
    case "total":
      return "bg-muted/60 hover:bg-muted/60 font-semibold [&>td]:border-t [&>td]:border-foreground/20";
    default:
      return "";
  }
}

