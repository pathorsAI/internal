"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Field } from "@/components/form-field";
import { AuditMeta } from "@/components/audit-meta";
import {
  PAYMENT_METHOD_KINDS,
  SYNCED_PAYMENT_METHOD_EDITABLE,
  type PaymentMethodKind,
} from "@/lib/vendor-billing/inputs";
import type { PaymentMethodRow } from "@/lib/vendor-billing/service";
import { deletePaymentMethodAction, savePaymentMethodAction } from "./actions";
import {
  DeleteDialog,
  DiscardDialog,
  ExpiryChip,
  FormActions,
  FormError,
  asKind,
  isoOf,
  textareaClass,
  type BankAccountOption,
} from "./shared";

export type MethodSheetTarget = { mode: "edit"; id: number; nonce: number } | { mode: "create"; nonce: number };

type MethodForm = {
  kind: PaymentMethodKind;
  label: string;
  brand: string;
  last4: string;
  expiryMonth: string;
  expiryYear: string;
  holderName: string;
  settlesFromAccountId: number | null;
  isActive: boolean;
  note: string;
};
type FormKey = keyof MethodForm;
const KEYS: FormKey[] = [
  "kind",
  "label",
  "brand",
  "last4",
  "expiryMonth",
  "expiryYear",
  "holderName",
  "settlesFromAccountId",
  "isActive",
  "note",
];

function formOf(row: PaymentMethodRow | undefined): MethodForm {
  return {
    kind: row ? asKind(row.kind) : "card",
    label: row?.label ?? "",
    brand: row?.brand ?? "",
    last4: row?.last4 ?? "",
    expiryMonth: row?.expiryMonth ? String(row.expiryMonth) : "",
    expiryYear: row?.expiryYear ? String(row.expiryYear) : "",
    holderName: row?.holderName ?? "",
    settlesFromAccountId: row?.settlesFromAccountId ?? null,
    isActive: row?.isActive ?? true,
    note: row?.note ?? "",
  };
}

/** 表單值 → action 的輸入：空字串存 null、月 / 年轉數字（驗證在 server 的 normalizePaymentMethodInput）。 */
function wireValue(k: FormKey, v: MethodForm[FormKey]): unknown {
  if (typeof v !== "string" || k === "kind" || k === "label") return v;
  const s = v.trim();
  if (s === "") return null;
  if (k === "expiryMonth" || k === "expiryYear") return Number(s);
  return s;
}

const digits = (s: string) => s.replace(/[\s•*-]/g, "");

function MethodHeader({
  row,
  synced,
  today,
}: Readonly<{ row: PaymentMethodRow | undefined; synced: boolean; today: string }>) {
  const t = useTranslations("vendorBilling");
  if (!row) {
    return (
      <SheetHeader className="shrink-0 border-b pr-10">
        <SheetTitle>{t("method.newTitle")}</SheetTitle>
        <SheetDescription className="sr-only">{t("method.newTitle")}</SheetDescription>
      </SheetHeader>
    );
  }
  const usedBy = row.accounts.map((a) => a.displayName).join(", ");
  return (
    <SheetHeader className="shrink-0 border-b pr-10">
      <SheetTitle className="flex flex-wrap items-center gap-2">
        {row.label}
        <Badge variant="outline">{t(`kind.${asKind(row.kind)}`)}</Badge>
        <Badge variant="secondary" className="font-normal">
          {t(synced ? "source.synced" : "source.manual")}
        </Badge>
        {row.isActive ? null : (
          <Badge variant="outline" className="text-muted-foreground">
            {t("cell.inactive")}
          </Badge>
        )}
        <ExpiryChip month={row.expiryMonth} year={row.expiryYear} today={today} />
      </SheetTitle>
      <SheetDescription className={usedBy ? "text-xs" : "sr-only"}>
        {usedBy ? `${t("method.usedBy")}：${usedBy}` : row.label}
      </SheetDescription>
    </SheetHeader>
  );
}

/** 表單狀態：開啟當下的值當基準，存檔成功後改成剛存的值（dirty 歸零）。 */
function useMethodForm(row: PaymentMethodRow | undefined, creating: boolean, synced: boolean, canManage: boolean) {
  const [base, setBase] = React.useState<MethodForm>(() => formOf(creating ? undefined : row));
  const [form, setForm] = React.useState<MethodForm>(base);
  const editable = (k: FormKey) => canManage && (!synced || SYNCED_PAYMENT_METHOD_EDITABLE.has(k));
  const keys = KEYS.filter(editable);
  const dirty = keys.some((k) => form[k] !== base[k]);
  const set = <K extends FormKey>(k: K, v: MethodForm[K]) => setForm((prev) => ({ ...prev, [k]: v }));

  /** PATCH：新增送全部；編輯只送改過、且這張卡允許改的欄位。 */
  function patch(id: number | null): Record<string, unknown> {
    const input: Record<string, unknown> = { id };
    for (const k of keys) {
      if (creating || form[k] !== base[k]) input[k] = wireValue(k, form[k]);
    }
    return input;
  }

  return { form, set, editable, dirty, patch, commit: () => setBase(form) };
}

export function PaymentMethodSheet({
  target,
  row,
  open,
  onOpenChange,
  canManage,
  today,
  bankAccounts,
}: Readonly<{
  target: MethodSheetTarget;
  row: PaymentMethodRow | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  today: string;
  bankAccounts: BankAccountOption[];
}>) {
  const t = useTranslations("vendorBilling");
  const creating = target.mode === "create";
  const methodId = target.mode === "edit" ? target.id : null;
  // 同步來的（Azure）卡：卡的事實以平台為準
  const synced = !creating && !!row && row.source !== "manual";

  const { form, set, editable, dirty, patch, commit } = useMethodForm(row, creating, synced, canManage);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  // 有人貼了完整卡號：不送出，直接在欄位下提示
  const last4TooLong = /^\d{5,}$/.test(digits(form.last4));

  function requestClose(next: boolean) {
    if (next || saving || deleting) return;
    if (canManage && dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (last4TooLong) return;
    setError(null);
    const input = patch(methodId);
    startSaving(async () => {
      const res = await savePaymentMethodAction(input);
      if (!res.ok) setError(res.error ?? t("toast.failed"));
      else if (creating) onOpenChange(false);
      else commit();
    });
  }

  function remove() {
    if (methodId === null) return;
    startDeleting(async () => {
      const res = await deletePaymentMethodAction(methodId);
      if (!res.ok) {
        toast.error(res.error ?? t("toast.failed"));
        return;
      }
      setConfirmDelete(false);
      onOpenChange(false);
    });
  }

  const id = (k: string) => `vb-method-${k}`;

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent className="w-full sm:max-w-xl">
          <MethodHeader row={creating ? undefined : row} synced={synced} today={today} />

          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" autoComplete="off">
            <div className="grid flex-1 content-start gap-4 overflow-y-auto px-4 pb-6 sm:grid-cols-2">
              <Field label={t("method.kind")} required={creating}>
                <Select
                  value={form.kind}
                  onValueChange={(v) => set("kind", asKind(v))}
                  disabled={!editable("kind")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`kind.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("method.label")} htmlFor={id("label")} required={creating}>
                <Input
                  id={id("label")}
                  value={form.label}
                  required
                  placeholder={t("method.labelPlaceholder")}
                  disabled={!editable("label")}
                  onChange={(e) => set("label", e.target.value)}
                />
              </Field>
              <Field label={t("method.brand")} htmlFor={id("brand")}>
                <Input
                  id={id("brand")}
                  value={form.brand}
                  disabled={!editable("brand")}
                  onChange={(e) => set("brand", e.target.value)}
                />
              </Field>
              <Field label={t("method.last4")} htmlFor={id("last4")}>
                <Input
                  id={id("last4")}
                  value={form.last4}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={last4TooLong || undefined}
                  aria-describedby={id("last4-help")}
                  disabled={!editable("last4")}
                  onChange={(e) => set("last4", e.target.value)}
                />
                <p
                  id={id("last4-help")}
                  className={last4TooLong ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
                >
                  {last4TooLong ? t("method.last4TooLong") : t("method.last4Help")}
                </p>
              </Field>
              <Field label={t("method.expiryMonth")} htmlFor={id("month")}>
                <Input
                  id={id("month")}
                  value={form.expiryMonth}
                  inputMode="numeric"
                  placeholder="MM"
                  disabled={!editable("expiryMonth")}
                  onChange={(e) => set("expiryMonth", e.target.value)}
                />
              </Field>
              <Field label={t("method.expiryYear")} htmlFor={id("year")}>
                <Input
                  id={id("year")}
                  value={form.expiryYear}
                  inputMode="numeric"
                  placeholder="YYYY"
                  disabled={!editable("expiryYear")}
                  onChange={(e) => set("expiryYear", e.target.value)}
                />
              </Field>
              <Field label={t("method.holderName")} htmlFor={id("holder")}>
                <Input
                  id={id("holder")}
                  value={form.holderName}
                  disabled={!editable("holderName")}
                  onChange={(e) => set("holderName", e.target.value)}
                />
              </Field>
              <Field label={t("method.settlesFrom")}>
                <Select
                  value={form.settlesFromAccountId === null ? "none" : String(form.settlesFromAccountId)}
                  onValueChange={(v) => set("settlesFromAccountId", v === "none" ? null : Number(v))}
                  disabled={!editable("settlesFromAccountId")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("picker.none")}</SelectItem>
                    {bankAccounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}（{a.currency}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => set("isActive", v)}
                  disabled={!editable("isActive")}
                />
                {t("method.isActive")}
              </label>
              <Field label={t("method.note")} htmlFor={id("note")} wide>
                <textarea
                  id={id("note")}
                  rows={2}
                  value={form.note}
                  disabled={!editable("note")}
                  onChange={(e) => set("note", e.target.value)}
                  className={textareaClass}
                />
              </Field>

              <FormError message={error} />

              {canManage ? (
                <FormActions
                  canDelete={!creating && !synced}
                  dirty={dirty && !last4TooLong}
                  saving={saving}
                  deleting={deleting}
                  onDelete={() => setConfirmDelete(true)}
                />
              ) : null}

              {row && !creating ? (
                <div className="border-t pt-4 sm:col-span-2">
                  <AuditMeta fallbackUpdatedAt={isoOf(row.updatedAt)} />
                </div>
              ) : null}
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <DiscardDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} onDiscard={() => onOpenChange(false)} />
      <DeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("method.deleteTitle")}
        description={t("method.deleteDescription")}
        pending={deleting}
        onConfirm={remove}
      />
    </>
  );
}
