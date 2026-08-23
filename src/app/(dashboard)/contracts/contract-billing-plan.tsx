"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, TextField } from "@/components/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, formatDate } from "@/lib/format";
import {
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
  const t = useTranslations("contracts");
  const tl = useTranslations("lib");
  const [plan, setPlan] = React.useState<string>(defaults?.billingPlan ?? UNSET);
  const [count, setCount] = React.useState<string>(String(defaults?.installmentCount ?? 3));
  const [split, setSplit] = React.useState<string>(
    defaults?.installmentSplit ?? formatSplit(defaultSplit(defaults?.installmentCount ?? 3)),
  );
  const [intervalMonths, setIntervalMonths] = React.useState<string>(
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

  // 期別名稱會寫進 billing_items.title，所以用當下語系產生。
  const installmentTitles = React.useMemo(
    () => ({
      full: tl("installment.full"),
      first: tl("installment.first"),
      final: tl("installment.final"),
      signing: tl("installment.signing"),
      interim: tl("installment.interim"),
      nth: (n: number) => tl("installment.nth", { n }),
    }),
    [tl],
  );

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
        intervalMonths: Number(intervalMonths) || 1,
        dueRule: dueRule as DueRule,
        dueDay: Number(dueDay) || null,
        signedDate: signedDate || null,
        startDate: startDate || null,
      }, installmentTitles),
    [plan, numericAmount, count, split, intervalMonths, dueRule, dueDay, signedDate, startDate, installmentTitles],
  );

  const previewTotal = preview.reduce((sum, r) => sum + r.amount, 0);

  return (
    <section className="space-y-3 rounded-lg border p-3 sm:col-span-2">
      <div className="flex items-center gap-2">
        <CalendarClock className="size-4 text-muted-foreground" />
        <div className="text-sm font-medium">{t("billingPlan.heading")}</div>
      </div>

      {/* Radix Select 不會送出 name，統一用 hidden input 帶值。 */}
      <input type="hidden" name="billingPlan" value={plan === UNSET ? "" : plan} />
      <input type="hidden" name="dueRule" value={dueRule} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("billingPlan.planLabel")}>
          <Select value={plan} onValueChange={setPlan}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>{t("billingPlan.planNone")}</SelectItem>
              <SelectItem value="single">{t("billingPlan.plan.single")}</SelectItem>
              <SelectItem value="installments">{t("billingPlan.plan.installments")}</SelectItem>
              <SelectItem value="milestones">{t("billingPlan.plan.milestones")}</SelectItem>
              <SelectItem value="subscription">{t("billingPlan.plan.subscription")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {isInstallments && (
          <TextField
            name="installmentCount"
            label={t("billingPlan.installmentCount")}
            type="number"
            min="1"
            max="60"
            value={count}
            onChange={(e) => onCountChange(e.target.value)}
          />
        )}

        {isInstallments && (
          <TextField
            name="installmentSplit"
            label={t("billingPlan.installmentSplit.label")}
            value={split}
            onChange={(e) => setSplit(e.target.value)}
            placeholder={t("billingPlan.installmentSplit.placeholder")}
          />
        )}

        {isInstallments && (
          <TextField
            name="billingIntervalMonths"
            label={t("billingPlan.intervalMonths")}
            type="number"
            min="1"
            max="12"
            value={intervalMonths}
            onChange={(e) => setIntervalMonths(e.target.value)}
          />
        )}

        {(isInstallments || plan === "single") && (
          <Field label={t("billingPlan.dueRuleLabel")} wide>
            <Select value={dueRule} onValueChange={setDueRule}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="signed_date">{t("billingPlan.dueRule.signed_date")}</SelectItem>
                <SelectItem value="day_of_month">{t("billingPlan.dueRule.day_of_month")}</SelectItem>
                <SelectItem value="business_day_of_month">
                  {t("billingPlan.dueRule.business_day_of_month")}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        {(isInstallments || plan === "single") && monthAnchored && (
          <Field
            label={
              dueRule === "business_day_of_month"
                ? t("billingPlan.dueDayLabelBusiness")
                : t("billingPlan.dueDayLabelDay")
            }
            htmlFor="dueDay"
            wide
          >
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
                ? t("billingPlan.dueDayHintBusiness")
                : t("billingPlan.dueDayHintDay")}
            </p>
          </Field>
        )}
      </div>

      {plan === "milestones" && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {t("billingPlan.milestoneHint")}
        </p>
      )}
      {plan === "subscription" && (
        <p className="flex gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          {t("billingPlan.subscriptionHint")}
        </p>
      )}

      {preview.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>{t("billingPlan.previewHeading", { count: preview.length })}</span>
            <span className="tabular-nums">
              {t("billingPlan.previewTotal", { amount: formatCurrency(previewTotal, currency) })}
            </span>
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
          {t("billingPlan.missingInputsHint")}
        </p>
      )}

      {existingCount > 0 && (isInstallments || plan === "single") && (
        <div className="space-y-1.5 rounded-md border border-dashed p-2.5">
          <label htmlFor="regenerateSchedule" className="flex items-start gap-2 text-sm">
            <input
              id="regenerateSchedule"
              type="checkbox"
              name="regenerateSchedule"
              checked={regenerate}
              onChange={(e) => setRegenerate(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span>{t("billingPlan.regenerateLabel")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("billingPlan.existingCount", { count: existingCount })}
                {lockedCount > 0 && t("billingPlan.lockedCountSuffix", { count: lockedCount })}
                {t("billingPlan.periodEnd")}
                {lockedCount > 0
                  ? t("billingPlan.regenerateNoteLocked")
                  : t("billingPlan.regenerateNoteAll")}
              </span>
            </span>
          </label>
        </div>
      )}

      {existingCount === 0 && preview.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("billingPlan.newScheduleNote")}
        </p>
      )}
    </section>
  );
}
