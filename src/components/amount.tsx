import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * 金額顏色語意：收入用 income（綠）、支出/負值用 expense（紅）、零或中性回傳空字串。
 * 顏色由 globals.css 的 --income / --expense token 統一定義，請勿在各頁面硬寫 green/emerald/red/rose。
 */

/** 依數值正負決定顏色（0 為中性，不上色）。 */
export function signColor(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "text-income" : "text-expense";
}

/** 依交易類型決定顏色：收入綠、支出/員工代墊紅，其餘中性。 */
export function txnTypeColor(type: string): string {
  if (type === "income") return "text-income";
  if (type === "expense" || type === "advance") return "text-expense";
  return "";
}


export type AmountKind = "income" | "expense" | "neutral";

/** 交易類型 → 金額的呈現方式：收入帶 +、支出與員工代墊帶 −，其餘（轉帳等）不帶號。 */
export function amountKind(type: string): AmountKind {
  if (type === "income") return "income";
  if (type === "expense" || type === "advance") return "expense";
  return "neutral";
}

/**
 * 金額的統一寫法：等寬數字；收入綠色帶「+」、支出墨色帶「−」、中性不帶號。
 * 支出不再用紅色 —— 一張表九成是支出，整片紅字等於沒有重點；紅色留給「逾期」「失敗」
 * 這種要人處理的狀態（text-destructive）。
 * income / expense 傳正數或負數都可以，正負號由 kind 決定；neutral 照 value 本身的正負；
 * 沒給 kind 就看 value 的正負。
 */
export function Amount({
  value,
  currency,
  kind,
  className,
}: Readonly<{
  value: number | string;
  currency?: string;
  kind?: AmountKind;
  className?: string;
}>) {
  const n = typeof value === "string" ? Number(value) : value;
  const safe = Number.isFinite(n) ? n : 0;
  const resolved: AmountKind = kind ?? (safe > 0 ? "income" : safe < 0 ? "expense" : "neutral");
  const abs = formatCurrency(Math.abs(safe), currency);
  // neutral（餘額、轉帳）不加號，但負值要留著「−」：透支的餘額不能看起來像正的。
  let sign = "";
  if (safe !== 0) {
    if (resolved === "income") sign = "+";
    else if (resolved === "expense" || safe < 0) sign = "−";
  }
  return (
    <span
      className={cn(
        "tabular-nums whitespace-nowrap",
        resolved === "income" && safe !== 0 && "text-income",
        className,
      )}
    >
      {sign}
      {abs}
    </span>
  );
}
