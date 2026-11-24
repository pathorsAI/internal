"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GlowButton } from "@/components/ds/glow-button";
import { Field } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { Amount } from "@/components/amount";
import { cn } from "@/lib/utils";
import { createJournalEntry } from "@/db/ledger-mutations";
import { AccountPicker, type AccountOption } from "./account-picker";

const LEDGERS = ["both", "government", "management"] as const;
const KINDS = ["manual", "opening", "adjustment"] as const;

type Line = { key: number; glAccountId: number | null; debit: string; credit: string; memo: string };

let lineSeq = 0;
const blankLine = (): Line => ({ key: ++lineSeq, glAccountId: null, debit: "", credit: "", memo: "" });

const toCents = (s: string) => {
  const v = Number(s.replaceAll(",", ""));
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0;
};

/** 新增手動分錄：GlowButton 打開 Sheet，行數可增減，下方即時顯示借貸合計與差額。 */
export function NewJournalEntry({
  accounts,
  today,
  currency,
}: Readonly<{ accounts: AccountOption[]; today: string; currency: string }>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);

  return (
    <>
      <GlowButton
        size="sm"
        onClick={() => {
          setNonce((n) => n + 1);
          setOpen(true);
        }}
      >
        <Plus className="size-4" /> {t("journal.add")}
      </GlowButton>
      <EntrySheet
        key={nonce}
        open={open}
        onOpenChange={setOpen}
        accounts={accounts}
        today={today}
        currency={currency}
        onSaved={() => {
          setOpen(false);
          router.refresh();
        }}
      />
    </>
  );
}

function EntrySheet({
  open,
  onOpenChange,
  accounts,
  today,
  currency,
  onSaved,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountOption[];
  today: string;
  currency: string;
  onSaved: () => void;
}>) {
  const t = useTranslations("accounting");
  const [date, setDate] = React.useState(today);
  const [ledger, setLedger] = React.useState<(typeof LEDGERS)[number]>("both");
  const [kind, setKind] = React.useState<(typeof KINDS)[number]>("manual");
  const [memo, setMemo] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>(() => [blankLine(), blankLine()]);
  const [pending, start] = useTransition();

  const debit = lines.reduce((s, l) => s + toCents(l.debit), 0);
  const credit = lines.reduce((s, l) => s + toCents(l.credit), 0);
  const diff = debit - credit;
  const filled = lines.filter((l) => l.glAccountId !== null && (toCents(l.debit) > 0) !== (toCents(l.credit) > 0));
  const canSave = !pending && date !== "" && filled.length >= 2 && filled.length === lines.length && diff === 0;

  const update = (key: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    start(async () => {
      const res = await createJournalEntry({
        date,
        ledger,
        kind,
        memo: memo || null,
        lines: lines.map((l) => ({
          glAccountId: l.glAccountId ?? 0,
          debit: toCents(l.debit) / 100,
          credit: toCents(l.credit) / 100,
          memo: l.memo || null,
        })),
      });
      if (!res.ok) {
        toast.error(res.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(t("journal.created"));
      onSaved();
    });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <SheetContent className="w-full sm:max-w-3xl">
        <SheetHeader className="shrink-0 border-b pr-10">
          <SheetTitle>{t("journal.sheetTitle")}</SheetTitle>
          <SheetDescription className="text-xs">{t("journal.sheetDescription")}</SheetDescription>
        </SheetHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" autoComplete="off">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("journal.date")} required>
                <DatePicker name="entryDate" defaultValue={today} onValueChange={setDate} />
              </Field>
              <Field label={t("journal.ledger")}>
                <Select value={ledger} onValueChange={(v) => setLedger(v as typeof ledger)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEDGERS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {t(`ledger.${l}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("journal.kind")}>
                <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`entryKind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("journal.memo")} htmlFor="je-memo" className="sm:col-span-3">
                <Input
                  id="je-memo"
                  value={memo}
                  placeholder={t("journal.memoPlaceholder")}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex flex-col gap-2">
              <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_minmax(0,0.7fr)_2rem] gap-2 text-xs font-medium text-muted-foreground sm:grid">
                <span>{t("journal.account")}</span>
                <span className="text-right">{t("journal.debit")}</span>
                <span className="text-right">{t("journal.credit")}</span>
                <span>{t("journal.lineMemo")}</span>
                <span />
              </div>
              {lines.map((l) => (
                <div
                  key={l.key}
                  className="grid grid-cols-2 gap-2 border-b pb-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_minmax(0,0.7fr)_2rem] sm:border-0 sm:pb-0"
                >
                  <div className="col-span-2 sm:col-span-1">
                    <AccountPicker
                      accounts={accounts}
                      value={l.glAccountId}
                      onChange={(id) => update(l.key, { glAccountId: id })}
                    />
                  </div>
                  <Input
                    aria-label={t("journal.debit")}
                    inputMode="decimal"
                    placeholder={t("journal.debit")}
                    className="text-right tabular-nums"
                    value={l.debit}
                    onChange={(e) => update(l.key, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                  />
                  <Input
                    aria-label={t("journal.credit")}
                    inputMode="decimal"
                    placeholder={t("journal.credit")}
                    className="text-right tabular-nums"
                    value={l.credit}
                    onChange={(e) => update(l.key, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                  />
                  <Input
                    aria-label={t("journal.lineMemo")}
                    placeholder={t("journal.lineMemo")}
                    value={l.memo}
                    onChange={(e) => update(l.key, { memo: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("journal.removeLine")}
                    disabled={lines.length <= 2}
                    className="text-muted-foreground"
                    onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, blankLine()])}>
                  <Plus className="size-4" /> {t("journal.addLine")}
                </Button>
              </div>
            </div>

            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm sm:ml-auto sm:w-80">
              <dt className="text-muted-foreground">{t("journal.debit")}</dt>
              <dd className="text-right">
                <Amount value={debit / 100} currency={currency} kind="neutral" />
              </dd>
              <dt className="text-muted-foreground">{t("journal.credit")}</dt>
              <dd className="text-right">
                <Amount value={credit / 100} currency={currency} kind="neutral" />
              </dd>
              <dd
                className={cn(
                  "col-span-2 pt-1 text-right text-xs font-medium",
                  diff === 0 ? "text-income" : "text-warning",
                )}
                aria-live="polite"
              >
                {diff === 0
                  ? t("journal.balanced")
                  : t("journal.difference", {
                      amount: new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(
                        Math.abs(diff) / 100,
                      ),
                    })}
              </dd>
            </dl>
          </div>
          <SheetFooter className="shrink-0 flex-row justify-end border-t">
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!canSave}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
