"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Mail, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type {
  SalaryApplyResult,
  SalaryFilingDefaults,
  SalaryFilingPreview,
} from "@/lib/simpany-payroll";
import {
  applySalaryFilingAction,
  cancelSalaryDraftAction,
  loadSalaryFilingDefaultsAction,
  prepareSalaryFilingAction,
  sendPayslipsAction,
  settleSalaryFilingAction,
} from "./simpany-salary-actions";

type Row = {
  name: string;
  employeeId: number | null;
  include: boolean;
  base: string;
  bonus: string;
  reimbursement: string;
  isCompanyOwner: boolean;
};

type Step =
  | { name: "loading" }
  | { name: "form" }
  | { name: "preview"; preview: SalaryFilingPreview }
  | { name: "applied"; preview: SalaryFilingPreview | null; result: SalaryApplyResult | null; appliedAt: string | null; draftId: number | null }
  | { name: "settled" };

const toInt = (s: string) => {
  const n = Number(s.replaceAll(",", "").trim());
  return Number.isFinite(n) ? Math.round(n) : Number.NaN;
};

function rowsFrom(d: SalaryFilingDefaults): Row[] {
  return d.employees.map((e) => ({
    name: e.name,
    employeeId: e.employeeId,
    include: true,
    base: e.baseSalary == null ? "" : String(e.baseSalary),
    bonus: "",
    reimbursement: "",
    isCompanyOwner: e.isCompanyOwner,
  }));
}

/** 預覽表：每人應發 / 個人負擔 / 公司負擔 / 扣繳 / 實發。 */
function PreviewTable({ preview }: Readonly<{ preview: SalaryFilingPreview }>) {
  const t = useTranslations("payroll.simpany.filing");
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="min-w-[560px]">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-3">{t("columns.employee")}</TableHead>
            <TableHead className="text-right">{t("columns.gross")}</TableHead>
            <TableHead className="text-right">{t("columns.personal")}</TableHead>
            <TableHead className="text-right">{t("columns.company")}</TableHead>
            <TableHead className="text-right">{t("columns.withholding")}</TableHead>
            <TableHead className="pr-3 text-right">{t("columns.net")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {preview.employees.map((e) => (
            <TableRow key={e.declarationId}>
              <TableCell className="pl-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{e.name}</span>
                  {e.isCompanyOwner ? <Badge variant="secondary">{t("owner")}</Badge> : null}
                  {e.ownerFlagChange ? (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                      {t("ownerChange")}
                    </Badge>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {t("columns.base")} {formatCurrency(e.baseSalary)}
                  {e.bonus > 0 ? ` · ${t("columns.bonus")} ${formatCurrency(e.bonus)}` : ""}
                  {e.reimbursement > 0 ? ` · ${t("columns.reimbursement")} ${formatCurrency(e.reimbursement)}` : ""}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(e.gross)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(e.personalBurden)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCurrency(e.companyInsurance)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(e.withholding)}</TableCell>
              <TableCell className="pr-3 text-right font-semibold tabular-nums">
                {e.net == null ? "—" : formatCurrency(e.net)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        {preview.employees.length > 1 ? (
          <TableFooter>
            <TableRow>
              <TableCell className="pl-3 font-medium">{t("total")}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(preview.totals.gross)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(preview.totals.personalBurden)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(preview.totals.companyInsurance)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCurrency(preview.totals.withholding)}</TableCell>
              <TableCell className="pr-3 text-right font-semibold tabular-nums">
                {formatCurrency(preview.totals.net)}
              </TableCell>
            </TableRow>
          </TableFooter>
        ) : null}
      </Table>
    </div>
  );
}

function Notice({
  tone,
  title,
  items,
}: Readonly<{ tone: "warn" | "risk"; title: string; items: string[] }>) {
  if (items.length === 0) return null;
  const cls =
    tone === "risk"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300";
  return (
    <div className={`space-y-1 rounded-md border px-3 py-2 text-sm ${cls}`}>
      <div className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-4" />
        {title}
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-xs">
        {items.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

/** 預覽的警示、問題、複製計畫、找不到的人。 */
function PreviewNotices({ preview }: Readonly<{ preview: SalaryFilingPreview }>) {
  const t = useTranslations("payroll.simpany.filing");
  const risks = [
    ...preview.problems.map((p) => `${p.name}：${p.message}`),
    ...(preview.notInSimpany.length ? [t("notInSimpany", { names: preview.notInSimpany.join("、") })] : []),
  ];
  const copy = preview.copy;
  const copyLine =
    copy?.required && copy.sourceYear != null && copy.sourceMonth != null
      ? t(copy.performed ? "copied" : "copyPlan", {
          names: copy.employees.join("、"),
          year: copy.sourceYear,
          month: copy.sourceMonth,
        })
      : null;
  return (
    <div className="space-y-2">
      <Notice tone="risk" title={t("problems")} items={risks} />
      {copyLine ? <Notice tone={copy?.performed ? "warn" : "risk"} title={t("warnings")} items={[copyLine]} /> : null}
      <Notice tone="warn" title={t("warnings")} items={preview.warnings} />
    </div>
  );
}

/** 寫入後：讀回來的實發比對。 */
function ApplyResultView({ result }: Readonly<{ result: SalaryApplyResult }>) {
  const t = useTranslations("payroll.simpany.filing");
  const bad = result.verification.filter((v) => !v.ok);
  return (
    <div className="space-y-2 text-sm">
      <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="size-4" />
        {t("applied", { names: result.written.join("、") })}
      </p>
      {bad.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("verified")}</p>
      ) : (
        <div className="space-y-1">
          <p className="text-xs text-amber-800 dark:text-amber-300">{t("mismatch")}</p>
          <div className="overflow-x-auto rounded-md border">
            <Table className="min-w-[360px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-3">{t("columns.employee")}</TableHead>
                  <TableHead className="text-right">{t("columns.expected")}</TableHead>
                  <TableHead className="pr-3 text-right">{t("columns.actual")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bad.map((v) => (
                  <TableRow key={v.name}>
                    <TableCell className="pl-3">{v.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {v.expectedNet == null ? "—" : formatCurrency(v.expectedNet)}
                    </TableCell>
                    <TableCell className="pr-3 text-right tabular-nums">
                      {v.actualNet == null ? "—" : formatCurrency(v.actualNet)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function Check({
  id,
  checked,
  onChange,
  children,
}: Readonly<{ id: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }>) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>{children}</span>
    </label>
  );
}

/** 結算（送給記帳士）：跟 Simpany 一樣要勾三個確認。 */
function SettlePanel({
  year,
  month,
  payday,
  ownerName,
  onSettled,
}: Readonly<{ year: number; month: number; payday: string | null; ownerName: string | null; onSettled: () => void }>) {
  const t = useTranslations("payroll.simpany.filing");
  const router = useRouter();
  const [pending, run] = useTransition();
  const [c, setC] = useState({ payday: false, owner: false, salary: false });
  const all = c.payday && c.owner && c.salary;

  function submit() {
    run(async () => {
      const res = await settleSalaryFilingAction({
        year,
        month,
        confirmPayday: c.payday,
        confirmOwner: c.owner,
        confirmSalary: c.salary,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("settled", { year, month }));
      router.refresh();
      onSettled();
    });
  }

  return (
    <section className="space-y-3 rounded-md border p-3">
      <div>
        <h3 className="text-sm font-medium">{t("settleTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("settleDescription")}</p>
      </div>
      <div className="space-y-2">
        <Check id="confirm-payday" checked={c.payday} onChange={(v) => setC({ ...c, payday: v })}>
          {t("confirmPayday", { date: payday ?? "—" })}
        </Check>
        <Check id="confirm-owner" checked={c.owner} onChange={(v) => setC({ ...c, owner: v })}>
          {ownerName ? t("confirmOwner", { name: ownerName }) : t("confirmOwnerUnknown")}
        </Check>
        <Check id="confirm-salary" checked={c.salary} onChange={(v) => setC({ ...c, salary: v })}>
          {t("confirmSalary")}
        </Check>
      </div>
      <Button size="sm" onClick={submit} disabled={!all || pending}>
        <Send className="size-4" />
        {pending ? t("settling") : t("settle")}
      </Button>
    </section>
  );
}

/** 已結算：寄薪資單。 */
function PayslipPanel({ year, month }: Readonly<{ year: number; month: number }>) {
  const t = useTranslations("payroll.simpany.filing");
  const router = useRouter();
  const [pending, run] = useTransition();
  const [confirm, setConfirm] = useState(false);

  function submit() {
    run(async () => {
      const res = await sendPayslipsAction(year, month);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("sent", { count: res.data.recipients.length }));
      setConfirm(false);
      router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-md border p-3">
      <p className="text-sm text-emerald-700 dark:text-emerald-400">{t("settledAlready")}</p>
      <p className="text-xs text-muted-foreground">{t("payslipsDescription")}</p>
      <Check id="confirm-send" checked={confirm} onChange={setConfirm}>
        {t("confirmSend")}
      </Check>
      <Button size="sm" variant="outline" onClick={submit} disabled={!confirm || pending}>
        <Mail className="size-4" />
        {pending ? t("sending") : t("send")}
      </Button>
    </section>
  );
}

/** 準備申報的輸入表：每人本薪 / 獎金 / 代墊款、發薪日、是否允許複製。 */
function FilingForm({
  defaults,
  rows,
  setRows,
  payday,
  setPayday,
  allowCopy,
  setAllowCopy,
}: Readonly<{
  defaults: SalaryFilingDefaults | null;
  rows: Row[];
  setRows: (r: Row[]) => void;
  payday: string;
  setPayday: (s: string) => void;
  allowCopy: boolean;
  setAllowCopy: (v: boolean) => void;
}>) {
  const t = useTranslations("payroll.simpany.filing");
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {defaults?.lastFiled
          ? t("lastFiled", { year: defaults.lastFiled.year, month: defaults.lastFiled.month })
          : t("noLastFiled")}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="salary-payday">{t("payday")}</Label>
        <Input
          id="salary-payday"
          type="date"
          value={payday}
          onChange={(e) => setPayday(e.target.value)}
          className="w-44"
        />
        <p className="text-xs text-muted-foreground">{t("paydayHint")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noEmployees")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table className="min-w-[520px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-3">{t("include")}</TableHead>
                <TableHead>{t("columns.employee")}</TableHead>
                <TableHead>{t("columns.base")}</TableHead>
                <TableHead>{t("columns.bonus")}</TableHead>
                <TableHead className="pr-3">{t("columns.reimbursement")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.name}>
                  <TableCell className="pl-3">
                    <input
                      type="checkbox"
                      aria-label={`${t("include")} ${r.name}`}
                      checked={r.include}
                      onChange={(e) => update(i, { include: e.target.checked })}
                      className="size-4 accent-primary"
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{r.name}</span>
                    {r.isCompanyOwner ? (
                      <Badge variant="secondary" className="ml-1.5">
                        {t("owner")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  {(["base", "bonus", "reimbursement"] as const).map((k) => (
                    <TableCell key={k} className={k === "reimbursement" ? "pr-3" : undefined}>
                      <Input
                        inputMode="numeric"
                        aria-label={`${r.name} ${t(`columns.${k}`)}`}
                        value={r[k]}
                        placeholder={k === "base" ? "" : "0"}
                        disabled={!r.include}
                        onChange={(e) => update(i, { [k]: e.target.value })}
                        className="h-8 w-28 tabular-nums"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("shareholderNote")}</p>
      <Check id="salary-allow-copy" checked={allowCopy} onChange={setAllowCopy}>
        <span className="text-xs">{t("allowCopy")}</span>
      </Check>
    </div>
  );
}

/**
 * 一個月的薪資申報 Sheet（owner / admin）：準備（Simpany 試算）→ 寫入 Simpany →
 * 送出給記帳士（三個確認）→ 寄薪資單。
 */
export function SalaryFilingSheet({
  year,
  month,
  settled,
}: Readonly<{ year: number; month: number; settled: boolean }>) {
  const t = useTranslations("payroll.simpany.filing");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ name: "loading" });
  const [defaults, setDefaults] = useState<SalaryFilingDefaults | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [payday, setPayday] = useState("");
  const [allowCopy, setAllowCopy] = useState(false);
  const [pending, run] = useTransition();

  function load() {
    setStep({ name: "loading" });
    run(async () => {
      const res = await loadSalaryFilingDefaultsAction(year, month);
      if (!res.ok) {
        toast.error(res.error);
        setOpen(false);
        return;
      }
      const d = res.data;
      setDefaults(d);
      setRows(rowsFrom(d));
      setPayday(d.payday);
      setAllowCopy(false);
      if (settled || d.latestDraft?.status === "settled") {
        setStep({ name: "settled" });
      } else if (d.latestDraft?.status === "applied") {
        const s = d.latestDraft.summary as unknown as SalaryFilingPreview;
        setStep({
          name: "applied",
          preview: Array.isArray(s?.employees) ? s : null,
          result: null,
          appliedAt: d.latestDraft.appliedAt ?? d.latestDraft.createdAt,
          draftId: d.latestDraft.id,
        });
      } else {
        setStep({ name: "form" });
      }
    });
  }

  function onOpenChange(v: boolean) {
    setOpen(v);
    if (v) load();
  }

  function calculate() {
    const chosen = rows.filter((r) => r.include);
    const employees = chosen.map((r) => ({
      name: r.name,
      employeeId: r.employeeId,
      baseSalary: toInt(r.base),
      bonus: r.bonus.trim() ? toInt(r.bonus) : 0,
      reimbursement: r.reimbursement.trim() ? toInt(r.reimbursement) : 0,
    }));
    const bad = employees.find(
      (e) => !(e.baseSalary > 0) || Number.isNaN(e.bonus) || Number.isNaN(e.reimbursement) || e.bonus < 0 || e.reimbursement < 0,
    );
    if (bad) {
      toast.error(`${bad.name}：${t("columns.base")} / ${t("columns.bonus")} / ${t("columns.reimbursement")}`);
      return;
    }
    run(async () => {
      const res = await prepareSalaryFilingAction({ year, month, payday, allowCopy, employees });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setStep({ name: "preview", preview: res.data });
    });
  }

  function apply(preview: SalaryFilingPreview) {
    if (preview.draftId == null) return;
    const draftId = preview.draftId;
    run(async () => {
      const res = await applySalaryFilingAction(draftId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      router.refresh();
      setStep({ name: "applied", preview, result: res.data, appliedAt: null, draftId });
    });
  }

  function back(preview: SalaryFilingPreview) {
    if (preview.draftId != null) {
      const id = preview.draftId;
      run(async () => {
        await cancelSalaryDraftAction(id);
      });
    }
    setStep({ name: "form" });
  }

  const title = t("title", { year, month });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <button type="button" className="text-left text-[11px] font-medium text-primary hover:underline">
          {settled ? t("payslips") : t("prepare")}
        </button>
      </SheetTrigger>
      <SheetContent className="data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {step.name === "loading" ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}

          {step.name === "form" ? (
            <FilingForm
              defaults={defaults}
              rows={rows}
              setRows={setRows}
              payday={payday}
              setPayday={setPayday}
              allowCopy={allowCopy}
              setAllowCopy={setAllowCopy}
            />
          ) : null}

          {step.name === "preview" ? (
            <div className="space-y-4">
              <PreviewNotices preview={step.preview} />
              {step.preview.employees.length ? <PreviewTable preview={step.preview} /> : null}
              {step.preview.draftId == null ? (
                <p className="text-sm text-destructive">{t("noDraft")}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("expires", {
                    id: step.preview.draftId,
                    time: step.preview.expiresAt ? formatDateTime(step.preview.expiresAt) : "—",
                  })}
                </p>
              )}
            </div>
          ) : null}

          {step.name === "applied" ? (
            <div className="space-y-4">
              {step.result ? (
                <ApplyResultView result={step.result} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("appliedEarlier", {
                    id: step.draftId ?? "—",
                    time: step.appliedAt ? formatDateTime(step.appliedAt) : "—",
                  })}
                </p>
              )}
              {step.preview?.employees.length ? <PreviewTable preview={step.preview} /> : null}
              <SettlePanel
                year={year}
                month={month}
                payday={step.result?.payday ?? step.preview?.payday ?? null}
                ownerName={step.preview?.companyOwner?.name ?? null}
                onSettled={() => setStep({ name: "settled" })}
              />
            </div>
          ) : null}

          {step.name === "settled" ? <PayslipPanel year={year} month={month} /> : null}
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          {step.name === "form" ? (
            <Button size="sm" onClick={calculate} disabled={pending || rows.every((r) => !r.include)}>
              {pending ? t("calculating") : t("calculate")}
            </Button>
          ) : null}
          {step.name === "preview" ? (
            <>
              <Button size="sm" variant="outline" onClick={() => back(step.preview)} disabled={pending}>
                {t("back")}
              </Button>
              <Button size="sm" onClick={() => apply(step.preview)} disabled={pending || step.preview.draftId == null}>
                {pending ? t("applying") : t("apply")}
              </Button>
            </>
          ) : null}
          {step.name === "applied" ? (
            <Button size="sm" variant="outline" onClick={() => setStep({ name: "form" })} disabled={pending}>
              {t("reprepare")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t("close")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
