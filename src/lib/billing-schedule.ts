/**
 * 合約請款計畫 → 請款排程（migrations/0019）。
 *
 * 全部是純函式，不碰 DB —— 合約表單的「即時預覽」與存檔時的實際展開共用同一份
 * 邏輯，預覽看到什麼就會存出什麼。展開的結果是 billing_items 實體列，之後人怎麼
 * 改都算數；本檔只負責「第一次長什麼樣」與「按重新產生時長什麼樣」。
 */
import { addMonths, format, getDaysInMonth, parseISO, setDate } from "date-fns";

export type BillingPlan = "single" | "installments" | "milestones" | "subscription";
export type DueRule = "signed_date" | "day_of_month" | "business_day_of_month";

export const BILLING_PLAN_LABELS: Record<BillingPlan, string> = {
  single: "一次付清",
  installments: "分 N 期",
  milestones: "里程碑",
  subscription: "月費 / 訂閱",
};

export const DUE_RULE_LABELS: Record<DueRule, string> = {
  signed_date: "簽約日起算，每期間隔固定月數",
  day_of_month: "每月第 N 個日曆日",
  business_day_of_month: "每月第 N 個工作日",
};

/** 分期預設比例：三期用業界常見的 30/40/30，其餘平均分攤。 */
export const DEFAULT_THREE_WAY_SPLIT = [30, 40, 30];

export function defaultSplit(count: number): number[] {
  if (count === 3) return [...DEFAULT_THREE_WAY_SPLIT];
  return Array.from({ length: count }, () => 100 / count);
}

/**
 * 解析 contracts.installment_split（'30,40,30'）。
 * 期數對不上、有非數字、總和不是 100（容許 0.01 的浮點誤差）一律退回預設，
 * 不擋存檔 —— 壞掉的參數不該讓使用者連合約都存不了。
 */
export function parseSplit(raw: string | null | undefined, count: number): number[] {
  if (!raw) return defaultSplit(count);
  const parts = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (parts.length !== count) return defaultSplit(count);
  const sum = parts.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) return defaultSplit(count);
  return parts;
}

export function formatSplit(split: number[]): string {
  // 整數就不要拖小數尾巴（'33.33,33.33,33.34' 才需要小數）
  return split.map((n) => (Number.isInteger(n) ? String(n) : n.toFixed(2))).join(",");
}

/**
 * 依比例把總額切成各期金額，四捨五入到分，**尾差全部進最後一期**，
 * 保證各期加總 === 總額（否則「合約完整性」報表會永遠差幾塊錢）。
 */
export function splitAmount(total: number, split: number[]): number[] {
  const out = split.map((pct) => Math.round(((total * pct) / 100) * 100) / 100);
  const diff = Math.round((total - out.reduce((a, b) => a + b, 0)) * 100) / 100;
  const lastIndex = out.length - 1;
  if (lastIndex >= 0 && diff !== 0) {
    out[lastIndex] = Math.round((out[lastIndex] + diff) * 100) / 100;
  }
  return out;
}

/**
 * 該月的第 n 個工作日（週一～週五）。
 *
 * 刻意只排除週末，不排除國定假日 —— 台灣的行事曆每年由人事行政總處另行公告
 * （還有補班日），本系統沒有那份資料，硬猜會比單純算週末更不可預期。落在假日的
 * 日期使用者可以在看板上逐筆改，改過的不會被蓋掉。
 *
 * n 超過該月工作日數時取當月最後一個工作日。
 */
export function nthBusinessDayOfMonth(reference: Date, n: number): Date {
  const total = getDaysInMonth(reference);
  let counted = 0;
  let last = setDate(reference, 1);
  for (let day = 1; day <= total; day += 1) {
    const d = setDate(reference, day);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    counted += 1;
    last = d;
    if (counted === n) return d;
  }
  return last;
}

/** 該月的第 n 個日曆日；超過該月天數取月底。 */
export function nthDayOfMonth(reference: Date, n: number): Date {
  return setDate(reference, Math.min(n, getDaysInMonth(reference)));
}

export type DueDateInput = {
  /** 基準日：簽約日，沒有就用合約起日 */
  baseDate: string;
  dueRule: DueRule;
  dueDay: number | null;
  intervalMonths: number;
};

/**
 * 第 index 期（0-based）的應請款日。
 *
 * 月份錨定的兩種規則（day_of_month / business_day_of_month）從基準日所在的月份開始
 * 算；若算出來的日子已經早於基準日（例如 8/20 簽約、規則是每月第 5 個工作日），
 * 就順延一個 interval —— 不會排一個已經過去的請款日。
 */
export function computeDueDate(input: DueDateInput, index: number): string {
  const { baseDate, dueRule, dueDay, intervalMonths } = input;
  const base = parseISO(baseDate);
  const step = Math.max(1, intervalMonths);

  if (dueRule === "signed_date" || dueDay == null) {
    return format(addMonths(base, index * step), "yyyy-MM-dd");
  }

  const pick = dueRule === "business_day_of_month" ? nthBusinessDayOfMonth : nthDayOfMonth;
  const firstMonth = pick(base, dueDay) < base ? addMonths(base, step) : base;
  return format(pick(addMonths(firstMonth, index * step), dueDay), "yyyy-MM-dd");
}

/** 期別名稱：常見期數給看得懂的名字，其餘退回「第 N 期」。 */
export function installmentTitle(index: number, count: number): string {
  if (count === 1) return "全額";
  if (count === 2) return ["頭款", "尾款"][index];
  if (count === 3) return ["簽約金", "期中款", "尾款"][index];
  return `第 ${index + 1} 期`;
}

export type ScheduleInput = {
  billingPlan: BillingPlan | null;
  /** 合約總額；沒填就展不出排程 */
  amount: number | null;
  installmentCount: number | null;
  installmentSplit: string | null;
  intervalMonths: number;
  dueRule: DueRule;
  dueDay: number | null;
  /** 簽約日；沒有就退回合約起日 */
  signedDate: string | null;
  startDate: string | null;
};

export type ScheduleRow = { title: string; amount: number; dueDate: string };

/**
 * 由請款計畫展開排程。
 *
 * 展不出來就回空陣列（不是錯誤）：里程碑要人自己逐筆加、月費走訂閱、沒設定計畫的
 * 舊合約維持現狀、沒有金額或沒有基準日的合約也不硬猜。
 */
export function generateSchedule(input: ScheduleInput): ScheduleRow[] {
  const { billingPlan, amount } = input;
  if (billingPlan !== "single" && billingPlan !== "installments") return [];
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return [];

  const baseDate = input.signedDate ?? input.startDate;
  if (!baseDate) return [];

  const count = billingPlan === "single" ? 1 : Math.max(1, input.installmentCount ?? 1);
  const split =
    billingPlan === "single" ? [100] : parseSplit(input.installmentSplit, count);
  const amounts = splitAmount(amount, split);
  const dueInput: DueDateInput = {
    baseDate,
    dueRule: input.dueRule,
    dueDay: input.dueDay,
    intervalMonths: input.intervalMonths,
  };

  return amounts.map((amt, i) => ({
    title: installmentTitle(i, count),
    amount: amt,
    dueDate: computeDueDate(dueInput, i),
  }));
}
