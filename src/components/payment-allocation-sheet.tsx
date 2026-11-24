"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plus, Split, X } from "lucide-react";
import {
  loadAllocationEditor,
  setTransactionAllocations,
  type AllocationEditorData,
  type AllocationTargetOption,
} from "@/db/mutations";
import { Amount } from "@/components/amount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  absorbShortfall,
  allocationTotals,
  lineShortfall,
  prefillAmount,
} from "@/lib/payment-allocation";
import { cn } from "@/lib/utils";

/** 編輯中的一列：金額用字串，讓人可以打到一半（"12."）。 */
type Draft = { uid: string; key: string; amount: string; fee: string; note: string | null };

function toNum(s: string): number {
  const n = Number(s);
  return s.trim() === "" || !Number.isFinite(n) ? 0 : n;
}

function money(n: number): string {
  return String(Math.round(n * 100) / 100);
}

let uidSeq = 0;
function uid(): string {
  uidSeq += 1;
  return `line-${uidSeq}`;
}

/**
 * 「分配收款」：把一筆入帳分給多個應收（訂閱期別／請款項目／合約），
 * 並把匯款被扣的手續費／匯差記在某一列的「手續費」，讓那一項算收齊。
 * 規則見 src/lib/payment-allocation.ts；寫入走 setTransactionAllocations（整組替換）。
 *
 * 受控元件：父層決定什麼時候打開。從看板打開時帶 prefillKey，會幫那一列預填
 * min(這筆還沒分出去的, 那一列還沒收的)。
 */
export function PaymentAllocationSheet({
  transactionId,
  open,
  onOpenChange,
  prefillKey,
}: Readonly<{
  transactionId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillKey?: string;
}>) {
  const t = useTranslations("allocations");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>{t("sheet.title")}</SheetTitle>
          <SheetDescription>{t("sheet.description")}</SheetDescription>
        </SheetHeader>
        {/* SheetContent 關閉時會卸載內容，所以每次打開都重新載入最新的分配。 */}
        <AllocationEditor
          transactionId={transactionId}
          prefillKey={prefillKey}
          onDone={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

/** 交易編輯表單上的入口按鈕（自己管開關）。 */
export function AllocatePaymentButton({ transactionId }: Readonly<{ transactionId: number }>) {
  const t = useTranslations("allocations");
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Split className="size-4" /> {t("trigger")}
      </Button>
      <PaymentAllocationSheet transactionId={transactionId} open={open} onOpenChange={setOpen} />
    </>
  );
}

type Loaded = { ok: true; data: AllocationEditorData } | { ok: false; error: string };

function initialDrafts(data: AllocationEditorData, prefillKey: string | undefined): Draft[] {
  const drafts: Draft[] = data.lines.map((l) => ({
    uid: uid(),
    key: l.key,
    amount: money(l.amount),
    fee: l.fee ? money(l.fee) : "",
    note: l.note ?? null,
  }));
  if (prefillKey && !drafts.some((d) => d.key === prefillKey)) {
    const target = data.targets.find((o) => o.key === prefillKey);
    if (target) {
      const { unallocated } = allocationTotals(data.txn.amount, data.lines);
      const amount = prefillAmount(unallocated, target.outstanding ?? unallocated);
      drafts.push({ uid: uid(), key: prefillKey, amount: money(amount), fee: "", note: null });
    }
  }
  return drafts;
}

function AllocationEditor({
  transactionId,
  prefillKey,
  onDone,
}: Readonly<{ transactionId: number; prefillKey?: string; onDone: () => void }>) {
  const t = useTranslations("allocations");
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [drafts, setDrafts] = React.useState<Draft[]>([]);

  React.useEffect(() => {
    let alive = true;
    loadAllocationEditor(transactionId).then(
      (res) => {
        if (!alive) return;
        setLoaded(res);
        if (res.ok) setDrafts(initialDrafts(res.data, prefillKey));
      },
      () => {
        // 錯誤文字在 render 時才翻（空字串＝通用的載入失敗），effect 不用依賴 t。
        if (alive) setLoaded({ ok: false, error: "" });
      },
    );
    return () => {
      alive = false;
    };
  }, [transactionId, prefillKey]);

  if (loaded === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t("sheet.loading")}
      </div>
    );
  }
  if (!loaded.ok) {
    return <p className="px-4 text-sm text-destructive">{loaded.error || t("sheet.loadFailed")}</p>;
  }
  return <EditorBody data={loaded.data} drafts={drafts} setDrafts={setDrafts} onDone={onDone} />;
}

function EditorBody({
  data,
  drafts,
  setDrafts,
  onDone,
}: Readonly<{
  data: AllocationEditorData;
  drafts: Draft[];
  setDrafts: React.Dispatch<React.SetStateAction<Draft[]>>;
  onDone: () => void;
}>) {
  const t = useTranslations("allocations");
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [absorbUid, setAbsorbUid] = React.useState<string | null>(null);
  const { txn, targets } = data;
  const byKey = React.useMemo(() => new Map(targets.map((o) => [o.key, o])), [targets]);

  const numeric = drafts.map((d) => ({ amount: toNum(d.amount), fee: toNum(d.fee) }));
  const totals = allocationTotals(txn.amount, numeric);
  const over = totals.unallocated < 0;

  // 吸收的那一列：預設最後一列（選過的那列被刪掉也退回最後一列）。
  const absorbIndex = (() => {
    const i = drafts.findIndex((d) => d.uid === absorbUid);
    return i >= 0 ? i : drafts.length - 1;
  })();

  function update(uidValue: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.uid === uidValue ? { ...d, ...patch } : d)));
  }

  function addLine() {
    setDrafts((prev) => [...prev, { uid: uid(), key: "", amount: "", fee: "", note: null }]);
  }

  function chooseTarget(uidValue: string, key: string) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.uid !== uidValue) return d;
        // 金額還空著就幫忙帶 min(還沒分出去的, 那一列還沒收的)。
        if (d.amount.trim() !== "") return { ...d, key };
        const rest = allocationTotals(
          txn.amount,
          prev.filter((x) => x.uid !== uidValue).map((x) => ({ amount: toNum(x.amount), fee: toNum(x.fee) })),
        ).unallocated;
        const outstanding = byKey.get(key)?.outstanding ?? rest;
        return { ...d, key, amount: money(prefillAmount(rest, outstanding)) };
      }),
    );
  }

  function absorb() {
    const lines = drafts.map((d) => ({
      ...d,
      amount: toNum(d.amount),
      fee: toNum(d.fee),
      outstanding: byKey.get(d.key)?.outstanding ?? null,
    }));
    const target = lines[absorbIndex];
    const shortfall = target ? lineShortfall(target) : null;
    if (!target || shortfall == null || shortfall <= 0) {
      toast.info(t("sheet.absorbNothing"));
      return;
    }
    const next = absorbShortfall(lines, absorbIndex);
    setDrafts(drafts.map((d, i) => ({ ...d, fee: next[i].fee ? money(next[i].fee) : "" })));
  }

  async function save() {
    setSaving(true);
    const res = await setTransactionAllocations(
      txn.id,
      drafts.map((d) => ({ key: d.key, amount: toNum(d.amount), fee: toNum(d.fee), note: d.note })),
    );
    setSaving(false);
    if (res.ok) {
      toast.success(drafts.length === 0 ? t("toast.cleared") : t("toast.saved"));
      onDone();
      router.refresh();
    } else {
      toast.error(res.error ?? t("toast.saveFailed"));
    }
  }

  const usedKeys = new Set(drafts.map((d) => d.key).filter(Boolean));
  const absorbLine = drafts[absorbIndex];
  const absorbLabel = absorbLine ? (byKey.get(absorbLine.key)?.label ?? `#${absorbIndex + 1}`) : "";

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
        <div className="text-sm text-muted-foreground">
          {formatDate(txn.txnDate)}
          {txn.partyName ? `　·　${txn.partyName}` : ""}
          {txn.description ? `　·　${txn.description}` : ""}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border px-3 py-2.5 text-sm sm:grid-cols-4">
          <Stat label={t("sheet.txnAmount")}>
            <Amount value={txn.amount} currency={txn.currency} kind="income" />
          </Stat>
          <Stat label={t("sheet.allocated")}>
            <Amount value={totals.allocated} currency={txn.currency} kind="neutral" />
          </Stat>
          <Stat label={t("sheet.unallocated")}>
            <span className={cn("tabular-nums", over && "text-destructive")}>
              {formatCurrency(totals.unallocated, txn.currency)}
            </span>
          </Stat>
          <Stat label={t("sheet.fees")}>
            <Amount value={totals.fees} currency={txn.currency} kind="neutral" />
          </Stat>
        </dl>
        {over ? <p className="-mt-2 text-xs text-destructive">{t("sheet.overAllocated")}</p> : null}

        {drafts.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t("sheet.empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {drafts.map((d, i) => (
              <LineRow
                key={d.uid}
                index={i}
                draft={d}
                currency={txn.currency}
                targets={targets}
                usedKeys={usedKeys}
                option={byKey.get(d.key)}
                onTarget={(key) => chooseTarget(d.uid, key)}
                onChange={(patch) => update(d.uid, patch)}
                onRemove={() => setDrafts((prev) => prev.filter((x) => x.uid !== d.uid))}
              />
            ))}
          </ul>
        )}

        <div>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="size-4" /> {t("sheet.addLine")}
          </Button>
        </div>

        {drafts.length > 0 ? (
          <div className="space-y-2 border-t pt-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor="absorb-line">{t("sheet.absorbLine")}</Label>
                <Select
                  value={drafts[absorbIndex]?.uid ?? ""}
                  onValueChange={(v) => setAbsorbUid(v)}
                >
                  <SelectTrigger id="absorb-line" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {drafts.map((d, i) => (
                      <SelectItem key={d.uid} value={d.uid}>
                        {`${i + 1}. ${byKey.get(d.key)?.label ?? t("line.targetPlaceholder")}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" onClick={absorb}>
                {t("sheet.absorb")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("sheet.absorbHint", { line: absorbLabel })}</p>
          </div>
        ) : null}
      </div>

      <SheetFooter className="shrink-0 border-t sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("sheet.cancel")}
        </Button>
        <Button
          type="button"
          disabled={saving || over}
          onClick={() => {
            void save();
          }}
        >
          {saving ? t("sheet.saving") : drafts.length === 0 && data.hasStoredAllocations ? t("sheet.clearAll") : t("sheet.save")}
        </Button>
      </SheetFooter>
    </>
  );
}

function Stat({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function LineRow({
  index,
  draft,
  currency,
  targets,
  usedKeys,
  option,
  onTarget,
  onChange,
  onRemove,
}: Readonly<{
  index: number;
  draft: Draft;
  currency: string;
  targets: AllocationTargetOption[];
  usedKeys: Set<string>;
  option: AllocationTargetOption | undefined;
  onTarget: (key: string) => void;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
}>) {
  const t = useTranslations("allocations");
  const groups: { id: string; label: string; items: AllocationTargetOption[] }[] = [
    { id: "same", label: t("group.customer"), items: targets.filter((o) => o.sameCustomer) },
    { id: "other", label: t("group.other"), items: targets.filter((o) => !o.sameCustomer) },
  ].filter((g) => g.items.length > 0);

  const shortfall = option
    ? lineShortfall({ amount: toNum(draft.amount), fee: toNum(draft.fee), outstanding: option.outstanding })
    : null;
  let status: React.ReactNode = null;
  if (shortfall != null) {
    if (shortfall > 0) status = t("line.shortfall", { amount: formatCurrency(shortfall, currency) });
    else if (shortfall < 0) status = t("line.over", { amount: formatCurrency(-shortfall, currency) });
    else status = <span className="text-income">{t("line.settled")}</span>;
  }

  return (
    <li className="grid gap-2 px-3 py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor={`${draft.uid}-target`} className="sr-only">
            {t("line.target")}
          </Label>
          <Select value={draft.key || undefined} onValueChange={onTarget}>
            <SelectTrigger id={`${draft.uid}-target`} className="w-full">
              <SelectValue placeholder={`${index + 1}. ${t("line.targetPlaceholder")}`} />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectGroup key={g.id}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.items.map((o) => (
                    <SelectItem key={o.key} value={o.key} disabled={o.key !== draft.key && usedKeys.has(o.key)}>
                      {`${t(`kind.${o.kind}`)}｜${o.label}${o.customerName ? ` · ${o.customerName}` : ""}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 text-muted-foreground"
          aria-label={t("sheet.removeLine")}
          onClick={onRemove}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${draft.uid}-amount`} className="text-xs text-muted-foreground">
            {t("line.amount")}
          </Label>
          <Input
            id={`${draft.uid}-amount`}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            className="tabular-nums"
            value={draft.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${draft.uid}-fee`} className="text-xs text-muted-foreground">
            {t("line.fee")}
          </Label>
          <Input
            id={`${draft.uid}-fee`}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0"
            className="tabular-nums"
            value={draft.fee}
            onChange={(e) => onChange({ fee: e.target.value })}
          />
        </div>
      </div>
      {option ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground tabular-nums">
          <span>
            {option.outstanding == null
              ? "—"
              : t("line.outstanding", { amount: formatCurrency(option.outstanding, currency) })}
          </span>
          <span>{status}</span>
        </div>
      ) : null}
    </li>
  );
}
