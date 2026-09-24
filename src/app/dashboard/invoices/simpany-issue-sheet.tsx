"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Field } from "@/components/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
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
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { InvoicePreview, IssueResult } from "@/lib/simpany-issue";
import type { SimpanyZeroTaxReason } from "@/lib/integrations/simpany";
import {
  cancelSimpanyDraftAction,
  issueSimpanyAction,
  loadZeroTaxReasonsAction,
  previewSimpanyAction,
  type SimpanyPreviewFormInput,
} from "./simpany-actions";

/** 這張發票從哪裡來：請款項目，或訂閱的某一期。 */
export type SimpanyIssueSource =
  | { kind: "billing_item"; billingItemId: number }
  | { kind: "subscription"; subscriptionId: number; periodStart: string };

type Step =
  | { name: "form" }
  | { name: "preview"; preview: InvoicePreview }
  | { name: "done"; result: IssueResult };

const AUTO = "auto";

/** 預設的零稅率原因（Simpany 清單還沒載入或載入失敗時用）。 */
const FALLBACK_ZERO_TAX_REASONS: SimpanyZeroTaxReason[] = [
  { code: "71", name: "外銷貨物" },
  { code: "72", name: "外銷勞務" },
];

/** 表單目前的值（字串原樣）加上已算好的外幣換算。 */
type IssueFormValues = {
  type: string;
  vat: string;
  name: string;
  address: string;
  emails: string;
  taxTreatment: string;
  zeroRateReason: string;
  itemName: string;
  amount: string;
  basis: "gross" | "net";
  remark: string;
  currency: string;
  foreignAmount: number;
  rate: number;
  twd: number | null;
};

function parseEmailList(emails: string): string[] {
  return emails
    .split(/[,，;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/** 品項：台幣直接用輸入金額；外幣要有匯率算出台幣才送，否則交給 server 端處理。 */
function buildItems(f: IssueFormValues, isForeign: boolean): SimpanyPreviewFormInput["items"] {
  if (!isForeign) return [{ name: f.itemName, quantity: 1, price: Number(f.amount) || 0 }];
  if (f.twd == null) return undefined;
  return [{ name: f.itemName, quantity: 1, price: f.twd }];
}

function buildPreviewInput(source: SimpanyIssueSource, f: IssueFormValues): SimpanyPreviewFormInput {
  const isForeign = f.currency.toUpperCase() !== "TWD";
  const emailList = parseEmailList(f.emails);
  const base: SimpanyPreviewFormInput =
    source.kind === "billing_item"
      ? { billingItemId: source.billingItemId }
      : { subscriptionId: source.subscriptionId, subscriptionPeriod: source.periodStart };
  const tt = f.taxTreatment === AUTO ? undefined : (f.taxTreatment as InvoicePreview["taxTreatment"]);
  return {
    ...base,
    type: f.type === AUTO ? undefined : (f.type as "B2B" | "B2C"),
    buyer: {
      vat: f.vat.trim() || null,
      name: f.name.trim() || undefined,
      address: f.address.trim() || undefined,
      emails: emailList.length ? emailList : undefined,
    },
    taxTreatment: tt,
    zeroRateReason: tt === "zero_rated" ? f.zeroRateReason : undefined,
    items: buildItems(f, isForeign),
    isTaxIncluded: isForeign ? undefined : f.basis === "gross",
    remark: f.remark.trim() || undefined,
    ...(isForeign
      ? {
          foreignCurrency: f.currency.toUpperCase(),
          foreignAmount: f.foreignAmount,
          exchangeRate: f.rate > 0 ? f.rate : undefined,
        }
      : {}),
  };
}

/**
 * 看板上的「在 Simpany 開立」：表單 → 預覽（server 端算好金額、檢查重複、存成草稿）→
 * 勾選確認 + 按「確認開立」才真的開。開立與 MCP 共用同一套 preview / issue 程式碼。
 */
export function SimpanyIssueSheet({
  source,
  customerName,
  customerTaxId,
  title,
  expected,
  currency,
}: Readonly<{
  source: SimpanyIssueSource;
  customerName: string | null;
  customerTaxId: string | null;
  title: string;
  expected: number;
  currency: string;
}>) {
  const t = useTranslations("invoices.simpany.issue");
  const tTax = useTranslations("invoices.taxTreatment");
  const router = useRouter();
  const isForeign = currency.toUpperCase() !== "TWD";

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>({ name: "form" });
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [reasons, setReasons] = useState<SimpanyZeroTaxReason[] | null>(null);

  // form state
  const [type, setType] = useState<string>(AUTO);
  const [vat, setVat] = useState(customerTaxId ?? "");
  const [name, setName] = useState(customerName ?? "");
  const [address, setAddress] = useState("");
  const [emails, setEmails] = useState("");
  const [taxTreatment, setTaxTreatment] = useState<string>(AUTO);
  const [zeroRateReason, setZeroRateReason] = useState("72");
  const [itemName, setItemName] = useState(title);
  const [amount, setAmount] = useState(String(expected));
  const [basis, setBasis] = useState<"gross" | "net">("gross");
  const [exchangeRate, setExchangeRate] = useState("");
  const [remark, setRemark] = useState("");

  const foreignAmount = Number(amount) || 0;
  const rate = Number(exchangeRate) || 0;
  const twd = isForeign && rate > 0 ? Math.round(foreignAmount * rate) : null;

  function ensureReasons() {
    if (reasons) return;
    loadZeroTaxReasonsAction().then(setReasons, () => setReasons([]));
  }

  function preview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    run(async () => {
      const res = await previewSimpanyAction(
        buildPreviewInput(source, {
          type,
          vat,
          name,
          address,
          emails,
          taxTreatment,
          zeroRateReason,
          itemName,
          amount,
          basis,
          remark,
          currency,
          foreignAmount,
          rate,
          twd,
        }),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirmed(false);
      setStep({ name: "preview", preview: res.data });
    });
  }

  function backToForm(draftId: number) {
    setError(null);
    setStep({ name: "form" });
    // 使用者決定不開這份草稿：作廢它（失敗也無妨，兩小時後自然過期）。
    void cancelSimpanyDraftAction(draftId);
  }

  function issue(draftId: number) {
    setError(null);
    run(async () => {
      const res = await issueSimpanyAction(draftId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStep({ name: "done", result: res.data });
      router.refresh();
    });
  }

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      if (step.name === "preview") void cancelSimpanyDraftAction(step.preview.draftId);
      setStep({ name: "form" });
      setError(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <Receipt className="size-4" /> {t("trigger")}
        </Button>
      </SheetTrigger>
      <SheetContent className="data-[side=right]:sm:max-w-lg">
        <SheetHeader className="shrink-0">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        {step.name === "form" ? (
          <form onSubmit={preview} className="flex min-h-0 flex-1 flex-col">
            <div className="grid flex-1 content-start gap-4 overflow-y-auto px-4 sm:grid-cols-2">
              <Field label={t("fields.name")} htmlFor="sp-name" required wide>
                <Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field label={t("fields.vat")} htmlFor="sp-vat">
                <Input
                  id="sp-vat"
                  inputMode="numeric"
                  value={vat}
                  placeholder={t("fields.vatPlaceholder")}
                  onChange={(e) => setVat(e.target.value)}
                />
              </Field>
              <Field label={t("fields.type")}>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>{t("fields.typeAuto")}</SelectItem>
                    <SelectItem value="B2B">B2B</SelectItem>
                    <SelectItem value="B2C">B2C</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("fields.address")} htmlFor="sp-address" wide>
                <Input id="sp-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </Field>
              <Field label={t("fields.emails")} htmlFor="sp-emails" wide>
                <Input
                  id="sp-emails"
                  value={emails}
                  placeholder={t("fields.emailsPlaceholder")}
                  onChange={(e) => setEmails(e.target.value)}
                />
              </Field>
              <Field label={t("fields.taxTreatment")}>
                <Select
                  value={taxTreatment}
                  onValueChange={(v) => {
                    setTaxTreatment(v);
                    if (v === "zero_rated") ensureReasons();
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={AUTO}>{t("fields.taxAuto")}</SelectItem>
                    <SelectItem value="taxable">{tTax("taxable")}</SelectItem>
                    <SelectItem value="zero_rated">{tTax("zero_rated")}</SelectItem>
                    <SelectItem value="exempt">{tTax("exempt")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {taxTreatment === "zero_rated" ? (
                <Field label={t("fields.zeroRateReason")}>
                  <Select value={zeroRateReason} onValueChange={setZeroRateReason}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(reasons?.length ? reasons : FALLBACK_ZERO_TAX_REASONS).map((r) => (
                        <SelectItem key={r.code} value={r.code}>
                          {r.code} {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : (
                <div className="hidden sm:block" />
              )}

              <Field label={t("fields.itemName")} htmlFor="sp-item" required wide>
                <Input id="sp-item" value={itemName} onChange={(e) => setItemName(e.target.value)} required />
              </Field>

              <AmountFields
                isForeign={isForeign}
                currency={currency}
                amount={amount}
                onAmountChange={setAmount}
                exchangeRate={exchangeRate}
                onExchangeRateChange={setExchangeRate}
                twd={twd}
                basis={basis}
                onBasisChange={setBasis}
              />

              <Field label={t("fields.remark")} htmlFor="sp-remark" wide>
                <Input
                  id="sp-remark"
                  value={remark}
                  placeholder={t("fields.remarkPlaceholder")}
                  onChange={(e) => setRemark(e.target.value)}
                />
              </Field>

              {error ? <ErrorBox message={error} /> : null}
            </div>
            <SheetFooter className="flex-row justify-end">
              <Button type="submit" disabled={pending}>
                {pending ? t("previewing") : t("preview")}
              </Button>
            </SheetFooter>
          </form>
        ) : null}

        {step.name === "preview" ? (
          <PreviewStep
            preview={step.preview}
            error={error}
            pending={pending}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
            onBack={() => backToForm(step.preview.draftId)}
            onIssue={() => issue(step.preview.draftId)}
          />
        ) : null}

        {step.name === "done" ? <DoneStep result={step.result} onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

/** 金額欄位：外幣要填原幣金額 + 匯率（顯示換算台幣），台幣填金額 + 含稅／未稅。 */
function AmountFields({
  isForeign,
  currency,
  amount,
  onAmountChange,
  exchangeRate,
  onExchangeRateChange,
  twd,
  basis,
  onBasisChange,
}: Readonly<{
  isForeign: boolean;
  currency: string;
  amount: string;
  onAmountChange: (v: string) => void;
  exchangeRate: string;
  onExchangeRateChange: (v: string) => void;
  twd: number | null;
  basis: "gross" | "net";
  onBasisChange: (v: "gross" | "net") => void;
}>) {
  const t = useTranslations("invoices.simpany.issue");
  if (isForeign) {
    return (
      <>
        <Field label={t("fields.foreignAmount", { currency })} htmlFor="sp-famount" required>
          <Input
            id="sp-famount"
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            required
          />
        </Field>
        <Field label={t("fields.exchangeRate")} htmlFor="sp-rate" required>
          <Input
            id="sp-rate"
            type="number"
            step="0.000001"
            value={exchangeRate}
            onChange={(e) => onExchangeRateChange(e.target.value)}
            required
          />
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {t("fields.exchangeRateHint", { twd: twd == null ? "—" : formatCurrency(twd, "TWD") })}
        </p>
      </>
    );
  }
  return (
    <>
      <Field label={t("fields.amount")} htmlFor="sp-amount" required>
        <Input
          id="sp-amount"
          type="number"
          step="1"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          required
        />
      </Field>
      <Field label={t("fields.basis")}>
        <Select value={basis} onValueChange={(v) => onBasisChange(v as "gross" | "net")}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gross">{t("fields.basisGross")}</SelectItem>
            <SelectItem value="net">{t("fields.basisNet")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

function PreviewStep({
  preview,
  error,
  pending,
  confirmed,
  onConfirmedChange,
  onBack,
  onIssue,
}: Readonly<{
  preview: InvoicePreview;
  error: string | null;
  pending: boolean;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
  onBack: () => void;
  onIssue: () => void;
}>) {
  const t = useTranslations("invoices.simpany.issue");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4">
        <PreviewCard preview={preview} />
        {error ? <ErrorBox message={error} /> : null}
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={confirmed}
            onChange={(e) => onConfirmedChange(e.target.checked)}
            disabled={pending}
          />
          <span>{t("confirmCheck")}</span>
        </label>
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          {t("back")}
        </Button>
        <Button type="button" onClick={onIssue} disabled={pending || !confirmed}>
          {pending ? t("issuing") : t("confirm")}
        </Button>
      </SheetFooter>
    </div>
  );
}

function DoneStep({ result, onClose }: Readonly<{ result: IssueResult; onClose: () => void }>) {
  const t = useTranslations("invoices.simpany.issue");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-2 px-4">
        <p className="flex items-center gap-2 text-base font-medium">
          <CheckCircle2 className="size-5 text-income" />
          {t("done", { number: result.invoiceNumber ?? result.externalId })}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("doneDetail", { total: result.total.toLocaleString("zh-TW") })}
        </p>
      </div>
      <SheetFooter className="flex-row justify-end">
        <Button type="button" onClick={onClose}>
          {t("close")}
        </Button>
      </SheetFooter>
    </div>
  );
}

function ErrorBox({ message }: Readonly<{ message: string }>) {
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2">
      {message}
    </p>
  );
}

function Row({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium">{children}</span>
    </div>
  );
}

/** 預覽品項沒有 id：用內容當 key，完全相同的品項再加上第幾次出現，確保唯一且穩定。 */
function withItemKeys<T extends { name: string; quantity: number; price: number }>(
  items: T[],
): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = `${item.name}|${item.quantity}|${item.price}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: `${base}|${n}`, item };
  });
}

function PreviewCard({ preview: p }: Readonly<{ preview: InvoicePreview }>) {
  const t = useTranslations("invoices.simpany.issue");
  const tTax = useTranslations("invoices.taxTreatment");
  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
        <Row label={t("summary.buyer")}>
          {p.type} · {p.buyer.name}
          {p.buyer.vat ? `（${p.buyer.vat}）` : ""}
        </Row>
        <Row label={t("summary.emails")}>
          {p.buyer.emails.length ? p.buyer.emails.join(", ") : t("summary.noEmails")}
        </Row>
        <Row label={t("summary.tax")}>
          {tTax(p.taxTreatment)}
          {p.zeroRateReason ? ` · ${p.zeroRateReason.code} ${p.zeroRateReason.name}` : ""}
        </Row>
        {p.foreign ? (
          <Row label={t("summary.foreign")}>
            {p.foreign.currency} {p.foreign.amount} × {p.foreign.exchangeRate} ={" "}
            {formatCurrency(p.foreign.twdAmount, "TWD")}
          </Row>
        ) : null}
        {p.remark ? <Row label={t("summary.remark")}>{p.remark}</Row> : null}
      </div>

      <div className="space-y-1 text-sm">
        <Label className="text-xs text-muted-foreground">{t("summary.items")}</Label>
        <ul className="divide-y rounded-lg border">
          {withItemKeys(p.items).map(({ key, item: it }) => (
            <li key={key} className="flex justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                {it.name}
                {it.quantity === 1 ? "" : ` × ${it.quantity}`}
              </span>
              <span className="tabular-nums">{formatCurrency(it.subTotal, "TWD")}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center">
        <div>
          <div className="text-xs text-muted-foreground">{t("summary.untaxed")}</div>
          <div className="text-sm font-medium tabular-nums">{formatCurrency(p.amounts.untaxed, "TWD")}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t("summary.taxAmount")}</div>
          <div className="text-sm font-medium tabular-nums">{formatCurrency(p.amounts.tax, "TWD")}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">{t("summary.total")}</div>
          <div className="text-base font-semibold tabular-nums">{formatCurrency(p.amounts.total, "TWD")}</div>
        </div>
      </div>

      {p.warnings.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4" /> {t("warningsTitle")}
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {p.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {t("expires", { time: formatDateTime(p.expiresAt) })}
      </p>
    </div>
  );
}
