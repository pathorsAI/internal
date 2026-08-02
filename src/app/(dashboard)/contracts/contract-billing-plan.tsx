"use client";

import * as React from "react";
import { CalendarClock, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  BILLING_PLAN_LABELS,
  DUE_RULE_LABELS,
  defaultSplit,
  formatSplit,
  generateSchedule,
  type BillingPlan,
  type DueRule,
} from "@/lib/billing-schedule";

/** Radix Select 不能有空字串 value，用這個當「未設定」的哨兵，送出前轉回空字串。 */
const UNSET = "none";

export type BillingPlanDefaults = {
  billingPlan: string | null;
  installmentCount: number | null;
  installmentSplit: string | null;
  billingIntervalMonths: number | null;
  dueRule: string | null;
  dueDay: number | null;
};

/**
 * 合約的「請款方式」區塊：設定一次，存檔就展開成請款排程。
 *
 * 預覽與伺服器端的展開共用 @/lib/billing-schedule 的同一份純函式，所以這裡看到
 * 幾期、每期多少、哪一天，存出來就是那樣。金額與日期由外層表單以 props 傳進來
 * （它們是既有欄位，不歸這個區塊管），所以外層必須把那幾格改成受控。
 */
export function ContractBillingPlanFields({
  amount,
  currency,
  signedDate,
  startDate,
  defaults,
  existingCount = 0,
  lockedCount = 0,
}: Readonly<{
  amount: string;
  currency: string;
  signedDate: string;
  startDate: string;
  defaults?: BillingPlanDefaults;
  /** 這張合約目前已經有幾筆請款項目（編輯時才有） */
  existingCount?: number;
  /** 其中已請款 / 已開票 / 已收款、重新產生時不會動到的筆數 */
  lockedCount?: number;
}>) {
  const [plan, setPlan] = React.useState<string>(defaults?.billingPlan ?? UNSET);
  const [count, setCount] = React.useState<string>(String(defaults?.installmentCount ?? 3));
  const [split, setSplit] = React.useState<string>(
    defaults?.installmentSplit ?? formatSplit(defaultSplit(defaults?.installmentCount ?? 3)),
  );
  const [interval, setInterval] = React.useState<string>(
    String(defaults?.billingIntervalMonths ?? 1),
  );
  const [dueRule, setDueRule] = React.useState<string>(defaults?.dueRule ?? "signed_date");
  const [dueDay, setDueDay] = React.useState<string>(
    defaults?.dueDay == null ? "5" : String(defaults.dueDay),
  );
  const [regenerate, setRegenerate] = React.useState(false);

  // 改期數時把比例跟著換成該期數的預設（三期 30/40/30，其餘平均）——
  // 使用者手改過的比例會在下一次改期數時被重設，這是刻意的：舊比例的長度已經不對了。
  function onCountChange(next: string) {
    setCount(next);
    const n = Number(next);
    if (Number.isFinite(n) && n >= 1 && n <= 60) setSplit(formatSplit(defaultSplit(n)));
  }

  const isInstallments = plan === "installments";
  const monthAnchored = dueRule === "day_of_month" || dueRule === "business_day_of_month";
  const numericAmount = amount === "" ? null : Number(amount);

  const preview = React.useMemo(
    () =>
      generateSchedule({
        billingPlan: plan === UNSET ? null : (plan as BillingPlan),
        amount: numericAmount,
        installmentCount: Number(count) || 1,
        installmentSplit: split,
        intervalMonths: Number(interval) || 1,
        dueRule: dueRule as DueRule,
        dueDay: Number(dueDay) || null,
        signedDate: signedDate || null,
        startDate: startDate || null,
      }),
    [plan, numericAmount, count, split, interval, dueRule, dueDay, signedDate, startDate],
  );

  const previewTotal = preview.reduce((sum, r) => sum + r.amount, 0);

  return (
    <section className="space-y-3 rounded-lg border p-3 sm:col-span-2">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4 text-muted-foreground" />
        <div className="text-sm font-medium">請款方式</div>
      </div>

      {/* Radix Select 不會送出 name，統一用 hidden input 帶值。 */}
      <input type="hidden" name="billingPlan" value={plan === UNSET ? "" : plan} />
      <input type="hidden" name="dueRule" value={dueRule} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>怎麼收這筆錢</Label>
          <Select value={plan} onValueChange={setPlan}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>— 不自動排程 —</SelectItem>
              <SelectItem value="single">{BILLING_PLAN_LABELS.single}</SelectItem>
              <SelectItem value="installments">{BILLING_PLAN_LABELS.installments}</SelectItem>
              <SelectItem value="milestones">{BILLING_PLAN_LABELS.milestones}</SelectItem>
              <SelectItem value="subscription">{BILLING_PLAN_LABELS.subscription}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isInstallments && (
          <div className="space-y-1.5">
            <Label htmlFor="installmentCount">期數</Label>
            <Input
              id="installmentCount"
              name="installmentCount"
              type="number"
              min="1"
              max="60"
              value={count}
              onChange={(e) => onCountChange(e.target.value)}
            />
          </div>
        )}

        {isInstallments && (
          <div className="space-y-1.5">
            <Label htmlFor="installmentSplit">各期比例（%）</Label>
            <Input
              id="installmentSplit"
              name="installmentSplit"
              value={split}
              onChange={(e) => setSplit(e.target.value)}
              placeholder="30,40,30"
            />
          </div>
        )}

        {isInstallments && (
          <div className="space-y-1.5">
            <Label htmlFor="billingIntervalMonths">每期間隔（月）</Label>
            <Input
              id="billingIntervalMonths"
              name="billingIntervalMonths"
              type="number"
              min="1"
              max="12"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            />
          </div>
        )}

        {(isInstallments || plan === "single") && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label>應請款日怎麼算</Label>
            <Select value={dueRule} onValueChange={setDueRule}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="signed_date">{DUE_RULE_LABELS.signed_date}</SelectItem>
                <SelectItem value="day_of_month">{DUE_RULE_LABELS.day_of_month}</SelectItem>
                <SelectItem value="business_day_of_month">
                  {DUE_RULE_LABELS.business_day_of_month}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {(isInstallments || plan === "single") && monthAnchored && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="dueDay">
              {dueRule === "business_day_of_month" ? "第幾個工作日" : "第幾日"}
            </Label>
            <Input
              id="dueDay"
              name="dueDay"
              type="number"
              min="1"
              max="31"
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {dueRule === "business_day_of_month"
                ? "工作日只排除週六日，不含國定假日（每年公告不同）。落在假日的那幾期，之後在看板上逐筆改即可。"
                : "超過該月天數會自動取月底（例：31 日 → 2 月底）。"}
            </p>
          </div>
        )}
      </div>

      {plan === "milestones" && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          里程碑的金額與日期各不相同，不由系統推導。存檔後在下方「分期請款」逐筆新增。
        </p>
      )}
      {plan === "subscription" && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          月費的期別由「訂閱 / 月費」的週期引擎推算，會直接出現在請款看板，這張合約不另外展開排程。
        </p>
      )}

      {preview.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>存檔後會產生這 {preview.length} 期</span>
            <span className="tabular-nums">合計 {formatCurrency(previewTotal, currency)}</span>
          </div>
          <ul className="divide-y rounded-md border bg-muted/30">
            {preview.map((r) => (
              <li
                key={`${r.title}-${r.dueDate}`}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
              >
                <span className="truncate">{r.title}</span>
                <span className="flex shrink-0 items-center gap-3 tabular-nums">
                  <span className="text-xs text-muted-foreground">{formatDate(r.dueDate)}</span>
                  <span>{formatCurrency(r.amount, currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview.length === 0 && (plan === "single" || isInstallments) && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          還缺合約金額或簽約日（沒有簽約日就用開始日期），補齊後這裡會顯示要產生的各期。
        </p>
      )}

      {existingCount > 0 && (isInstallments || plan === "single") && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2.5">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="regenerateSchedule"
              checked={regenerate}
              onChange={(e) => setRegenerate(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              存檔時依上面的設定重新產生排程
              <span className="mt-0.5 block text-xs text-muted-foreground">
                這張合約已有 {existingCount} 期
                {lockedCount > 0 && `，其中 ${lockedCount} 期已請款 / 已開票 / 已收款`}。
                {lockedCount > 0
                  ? "已經動過的那幾期不會被刪，只重排其餘的。"
                  : "既有的排程會被取代。"}
              </span>
            </span>
          </label>
        </div>
      )}

      {existingCount === 0 && preview.length > 0 && (
        <p className="text-xs text-muted-foreground">
          存檔後可到請款看板逐筆調整金額與日期，改過的不會被這份設定蓋掉。
        </p>
      )}
    </section>
  );
}
