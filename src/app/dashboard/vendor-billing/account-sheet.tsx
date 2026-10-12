"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Field } from "@/components/form-field";
import { AuditMeta } from "@/components/audit-meta";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  LEDGER_MODES,
  SYNCED_ACCOUNT_EDITABLE,
  VENDOR_PROVIDERS,
  type LedgerModeValue,
  type VendorProvider,
} from "@/lib/vendor-billing/inputs";
import type { BillingAccountRow, PaymentMethodRow } from "@/lib/vendor-billing/service";
import {
  billingAccountDetailAction,
  deleteBillingAccountAction,
  saveBillingAccountAction,
  verifyBillingAccountAction,
} from "./actions";
import { InvoiceList } from "./invoice-list";
import { MultiSearchSelect, SearchSelect, type PickerOption } from "./pickers";
import {
  AccountStatusChip,
  DeleteDialog,
  DiscardDialog,
  ExpiryChip,
  FormActions,
  FormError,
  ProviderBadge,
  asKind,
  asLedgerMode,
  asProvider,
  dateTime,
  expiryText,
  isoOf,
  textareaClass,
  type MemberOption,
  type Option,
  type VbT,
} from "./shared";

export type AccountSheetTarget =
  | { mode: "edit"; id: number; focusInvoices?: boolean; nonce: number }
  | { mode: "create"; nonce: number };

type Detail = NonNullable<Awaited<ReturnType<typeof billingAccountDetailAction>>>;

type AccountForm = {
  provider: VendorProvider;
  displayName: string;
  externalId: string;
  paymentMethodId: number | null;
  partyId: number | null;
  matchPartyIds: number[];
  ownerUserId: string | null;
  ledgerMode: LedgerModeValue;
  status: string;
  note: string;
};

type FormKey = keyof AccountForm;

function formOf(row: BillingAccountRow | undefined): AccountForm {
  return {
    provider: row ? asProvider(row.provider) : "azure",
    displayName: row?.displayName ?? "",
    externalId: row?.externalId ?? "",
    paymentMethodId: row?.paymentMethod?.id ?? null,
    partyId: row?.partyId ?? null,
    matchPartyIds: row?.matchPartyIds ?? [],
    ownerUserId: row?.ownerUserId ?? null,
    ledgerMode: asLedgerMode(row?.ledgerMode ?? "match_only"),
    status: row?.status ?? "active",
    note: row?.note ?? "",
  };
}

const same = (a: AccountForm[FormKey], b: AccountForm[FormKey]) => JSON.stringify(a) === JSON.stringify(b);

// 手動帳號編輯時可以改的欄位（平台與 ID 只在新增時填）；同步帳號只能改 SYNCED_ACCOUNT_EDITABLE。
const MANUAL_EDITABLE: ReadonlySet<FormKey> = new Set([
  "displayName",
  "paymentMethodId",
  "partyId",
  "matchPartyIds",
  "ownerUserId",
  "ledgerMode",
  "status",
  "note",
]);
const CREATE_KEYS: FormKey[] = [
  "provider",
  "displayName",
  "externalId",
  "paymentMethodId",
  "partyId",
  "matchPartyIds",
  "ownerUserId",
  "ledgerMode",
  "note",
];

/** 表單值 → action 的輸入；空字串存成 null。 */
function wireValue(k: FormKey, v: AccountForm[FormKey]): unknown {
  if (k === "externalId" || k === "note") return typeof v === "string" && v.trim() !== "" ? v : null;
  return v;
}

function SectionTitle({ children }: Readonly<{ children: React.ReactNode }>) {
  return <h3 className="text-sm font-medium">{children}</h3>;
}

/** 骨架的區塊與列數（固定的鍵，不用陣列索引當 key）。 */
const SKELETON_SECTIONS = [
  { key: "resources", rows: ["r1", "r2", "r3"] },
  { key: "invoices", rows: ["i1", "i2", "i3", "i4"] },
  { key: "costs", rows: ["c1", "c2", "c3"] },
] as const;

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      {SKELETON_SECTIONS.map((section) => (
        <div key={section.key} className="space-y-2 border-t pt-4">
          <Skeleton className="h-4 w-20" />
          {section.rows.map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

type SetField = <K extends FormKey>(k: K, v: AccountForm[K]) => void;
type FieldProps = Readonly<{ form: AccountForm; set: SetField; editable: (k: FormKey) => boolean }>;

const fieldId = (k: string) => `vb-account-${k}`;
const toId = (v: string | null) => (v === null ? null : Number(v));
const fromId = (v: number | null) => (v === null ? null : String(v));

/** 表單狀態：開啟當下的值當基準，存檔成功後改成剛存的值（dirty 歸零）。 */
function useAccountForm(row: BillingAccountRow | undefined, creating: boolean, canManage: boolean) {
  const synced = !creating && row?.source === "synced";
  const [base, setBase] = React.useState<AccountForm>(() => formOf(creating ? undefined : row));
  const [form, setForm] = React.useState<AccountForm>(base);

  const editable = (k: FormKey): boolean => {
    if (!canManage) return false;
    if (creating) return true;
    return synced ? SYNCED_ACCOUNT_EDITABLE.has(k) : MANUAL_EDITABLE.has(k);
  };
  const keys: FormKey[] = creating ? CREATE_KEYS : [...MANUAL_EDITABLE].filter(editable);
  const dirty = keys.some((k) => !same(form[k], base[k]));
  const set: SetField = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  /** PATCH：新增送全部；編輯只送改過、且這個帳號允許改的欄位。 */
  function patch(id: number | null): Record<string, unknown> {
    const input: Record<string, unknown> = { id };
    for (const k of keys) {
      if (creating || !same(form[k], base[k])) input[k] = wireValue(k, form[k]);
    }
    return input;
  }

  return { form, set, editable, dirty, synced, patch, commit: () => setBase(form) };
}

/** 帳號詳細（資源、帳單、費用）：開啟時載入，帳單動作之後重載。 */
function useAccountDetail(accountId: number | null, focusInvoices: boolean) {
  const [detail, setDetail] = React.useState<Detail | null>(null);
  const [loading, startLoading] = useTransition();
  const invoicesRef = React.useRef<HTMLDivElement>(null);

  const reload = React.useCallback(() => {
    if (accountId === null) return;
    startLoading(async () => {
      setDetail(await billingAccountDetailAction(accountId));
    });
  }, [accountId]);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // 從帳單對帳那頁點進來 → 載入完捲到帳單區
  React.useEffect(() => {
    if (focusInvoices && detail) invoicesRef.current?.scrollIntoView({ block: "start" });
  }, [focusInvoices, detail]);

  return { detail, loading, reload, invoicesRef };
}

/** 同步帳號顯示最後同步時間；手動帳號顯示最後確認時間（或從未確認）。 */
function metaLineOf(row: BillingAccountRow, t: VbT): string | null {
  if (row.source === "synced") {
    const d = dateTime(row.lastSeenAt);
    return d ? t("account.lastSynced", { date: d }) : null;
  }
  const d = dateTime(row.lastVerifiedAt);
  return d ? t("account.lastVerified", { date: d }) : t("account.neverVerified");
}

function methodHint(m: PaymentMethodRow, today: string, t: VbT): React.ReactNode {
  if (!m.expiryMonth || !m.expiryYear) return t(`kind.${asKind(m.kind)}`);
  return (
    <span className="inline-flex items-center gap-1.5">
      {expiryText(m.expiryMonth, m.expiryYear)}
      <ExpiryChip month={m.expiryMonth} year={m.expiryYear} today={today} />
    </span>
  );
}

/** 付款方式選項：停用的不給挑，但目前選著的仍要列出來。 */
function methodOptionsOf(methods: PaymentMethodRow[], selected: number | null, today: string, t: VbT): PickerOption[] {
  return methods
    .filter((m) => m.isActive || m.id === selected)
    .map((m) => ({
      value: String(m.id),
      label: m.label,
      keywords: [m.brand, m.last4].filter(Boolean).join(" "),
      hint: methodHint(m, today, t),
    }));
}

function AccountHeader({
  row,
  creating,
  canManage,
  verifying,
  onVerify,
}: Readonly<{
  row: BillingAccountRow | undefined;
  creating: boolean;
  canManage: boolean;
  verifying: boolean;
  onVerify: () => void;
}>) {
  const t = useTranslations("vendorBilling");
  if (creating || !row) {
    return (
      <SheetHeader className="shrink-0 border-b pr-10">
        <SheetTitle>{creating ? t("account.newTitle") : <Skeleton className="h-5 w-40" />}</SheetTitle>
        <SheetDescription className="sr-only">{t("account.newTitle")}</SheetDescription>
      </SheetHeader>
    );
  }
  const metaLine = metaLineOf(row, t);
  return (
    <SheetHeader className="shrink-0 border-b pr-10">
      <SheetTitle className="flex flex-wrap items-center gap-2">
        {row.displayName}
        <ProviderBadge provider={row.provider} />
        <Badge variant="secondary" className="font-normal">
          {t(row.source === "synced" ? "source.synced" : "source.manual")}
        </Badge>
        <AccountStatusChip status={row.status} />
      </SheetTitle>
      <SheetDescription asChild>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {row.externalId ? <span className="font-mono text-xs">{row.externalId}</span> : null}
          {metaLine ? <span className="text-xs">{metaLine}</span> : null}
          {row.source === "manual" && canManage ? (
            <Button type="button" size="xs" variant="outline" onClick={onVerify} disabled={verifying}>
              {t("actions.verify")}
            </Button>
          ) : null}
        </div>
      </SheetDescription>
    </SheetHeader>
  );
}

/** 只在新增時出現：平台與平台上的帳號 ID。 */
function CreateOnlyFields({ form, set }: FieldProps) {
  const t = useTranslations("vendorBilling");
  return (
    <>
      <Field label={t("account.provider")} required>
        <Select value={form.provider} onValueChange={(v) => set("provider", asProvider(v))}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {VENDOR_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {t(`provider.${p}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("account.externalId")} htmlFor={fieldId("external")}>
        <Input
          id={fieldId("external")}
          value={form.externalId}
          placeholder={t("account.optional")}
          onChange={(e) => set("externalId", e.target.value)}
          spellCheck={false}
        />
      </Field>
    </>
  );
}

function PartyFields({ form, set, editable, parties }: FieldProps & Readonly<{ parties: Option[] }>) {
  const t = useTranslations("vendorBilling");
  const partyOptions: PickerOption[] = React.useMemo(
    () => parties.map((p) => ({ value: String(p.id), label: p.name })),
    [parties],
  );
  const matchOptions = React.useMemo(
    () => partyOptions.filter((o) => o.value !== String(form.partyId ?? "")),
    [partyOptions, form.partyId],
  );
  return (
    <>
      <Field label={t("account.party")} htmlFor={fieldId("party")}>
        <SearchSelect
          id={fieldId("party")}
          options={partyOptions}
          value={fromId(form.partyId)}
          onChange={(v) => set("partyId", toId(v))}
          noneLabel={t("picker.none")}
          disabled={!editable("partyId")}
        />
      </Field>
      <Field label={t("account.matchParties")} wide>
        <MultiSearchSelect
          options={matchOptions}
          values={form.matchPartyIds.map(String)}
          onChange={(vs) => set("matchPartyIds", vs.map(Number))}
          disabled={!editable("matchPartyIds")}
          addLabel={t("account.addParty")}
          removeLabel={(name) => t("account.removeParty", { name })}
        />
      </Field>
    </>
  );
}

function OwnerField({ form, set, editable, members }: FieldProps & Readonly<{ members: MemberOption[] }>) {
  const t = useTranslations("vendorBilling");
  return (
    <Field label={t("account.owner")}>
      <Select
        value={form.ownerUserId ?? "none"}
        onValueChange={(v) => set("ownerUserId", v === "none" ? null : v)}
        disabled={!editable("ownerUserId")}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("picker.none")}</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** 手動帳號可以自己標成已關閉（同步帳號的狀態由平台決定）。 */
function StatusField({ form, set, editable }: FieldProps) {
  const t = useTranslations("vendorBilling");
  return (
    <Field label={t("account.status")}>
      <Select value={form.status} onValueChange={(v) => set("status", v)} disabled={!editable("status")}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">{t("status.active")}</SelectItem>
          <SelectItem value="closed">{t("status.closed")}</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

function LedgerModeOption({
  mode,
  on,
  disabled,
  onSelect,
}: Readonly<{ mode: LedgerModeValue; on: boolean; disabled: boolean; onSelect: () => void }>) {
  const t = useTranslations("vendorBilling");
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        on ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span
          aria-hidden
          className={cn("size-3.5 shrink-0 rounded-full border", on ? "border-4 border-primary" : "border-input")}
        />
        {t(`account.ledger.${mode}.title`)}
      </span>
      <span className="mt-0.5 block pl-5.5 text-xs text-muted-foreground">{t(`account.ledger.${mode}.help`)}</span>
    </button>
  );
}

function LedgerModeField({ form, set, editable }: FieldProps) {
  const t = useTranslations("vendorBilling");
  return (
    <Field label={t("account.ledgerMode")} wide>
      <div role="radiogroup" aria-label={t("account.ledgerMode")} className="grid gap-2 sm:grid-cols-2">
        {LEDGER_MODES.map((m) => (
          <LedgerModeOption
            key={m}
            mode={m}
            on={form.ledgerMode === m}
            disabled={!editable("ledgerMode")}
            onSelect={() => set("ledgerMode", m)}
          />
        ))}
      </div>
    </Field>
  );
}

/** 表單下方的資源 / 帳單 / 費用；載入中顯示同尺寸的骨架。 */
function DetailArea({
  detail,
  loading,
  today,
  canManage,
  onChanged,
  invoicesRef,
}: Readonly<{
  detail: Detail | null;
  loading: boolean;
  today: string;
  canManage: boolean;
  onChanged: () => void;
  invoicesRef: React.RefObject<HTMLDivElement | null>;
}>) {
  if (detail) {
    return (
      <DetailSections
        detail={detail}
        today={today}
        canManage={canManage}
        onChanged={onChanged}
        invoicesRef={invoicesRef}
      />
    );
  }
  return loading ? <DetailSkeleton /> : null;
}

export function AccountSheet({
  target,
  row: liveRow,
  open,
  onOpenChange,
  canManage,
  today,
  parties,
  methods,
  members,
}: Readonly<{
  target: AccountSheetTarget;
  /** 編輯模式時列表上那一列（server 重新 render 後會帶最新值） */
  row: BillingAccountRow | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  today: string;
  parties: Option[];
  methods: PaymentMethodRow[];
  members: MemberOption[];
}>) {
  const t = useTranslations("vendorBilling");
  // 刪除後列表上已經沒有這一列，收合動畫期間仍顯示最後看到的資料
  const [lastRow, setLastRow] = React.useState(liveRow);
  if (liveRow && liveRow !== lastRow) setLastRow(liveRow);
  const row = liveRow ?? lastRow;
  const creating = target.mode === "create";
  const accountId = target.mode === "edit" ? target.id : null;

  const { form, set, editable, dirty, synced, patch, commit } = useAccountForm(row, creating, canManage);
  const { detail, loading, reload, invoicesRef } = useAccountDetail(
    accountId,
    target.mode === "edit" && target.focusInvoices === true,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [verifying, startVerifying] = useTransition();

  const methodOptions = React.useMemo(
    () => methodOptionsOf(methods, form.paymentMethodId, today, t),
    [methods, form.paymentMethodId, today, t],
  );

  function requestClose(next: boolean) {
    if (next || saving || deleting) return;
    if (canManage && dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const input = patch(accountId);
    startSaving(async () => {
      const res = await saveBillingAccountAction(input);
      if (!res.ok) setError(res.error ?? t("toast.failed"));
      else if (creating) onOpenChange(false);
      else commit();
    });
  }

  function verify() {
    if (accountId === null) return;
    startVerifying(async () => {
      const res = await verifyBillingAccountAction(accountId);
      if (!res.ok) toast.error(res.error ?? t("toast.failed"));
    });
  }

  function remove() {
    if (accountId === null) return;
    startDeleting(async () => {
      const res = await deleteBillingAccountAction(accountId);
      if (!res.ok) {
        toast.error(res.error ?? t("toast.failed"));
        return;
      }
      setConfirmDelete(false);
      onOpenChange(false);
    });
  }

  const fieldProps = { form, set, editable };
  const showDetail = !creating;

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent className="w-full sm:max-w-3xl">
          <AccountHeader
            row={row}
            creating={creating}
            canManage={canManage}
            verifying={verifying}
            onVerify={verify}
          />

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6">
            <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" autoComplete="off">
              {creating ? <CreateOnlyFields {...fieldProps} /> : null}

              <Field label={t("account.displayName")} htmlFor={fieldId("name")} required={creating} wide>
                <Input
                  id={fieldId("name")}
                  value={form.displayName}
                  required
                  disabled={!editable("displayName")}
                  onChange={(e) => set("displayName", e.target.value)}
                />
              </Field>

              <Field label={t("account.paymentMethod")} htmlFor={fieldId("pm")}>
                <SearchSelect
                  id={fieldId("pm")}
                  options={methodOptions}
                  value={fromId(form.paymentMethodId)}
                  onChange={(v) => set("paymentMethodId", toId(v))}
                  noneLabel={t("picker.none")}
                  disabled={!editable("paymentMethodId")}
                />
              </Field>

              <PartyFields {...fieldProps} parties={parties} />
              <OwnerField {...fieldProps} members={members} />
              {showDetail && !synced ? <StatusField {...fieldProps} /> : null}
              <LedgerModeField {...fieldProps} />

              <Field label={t("account.note")} htmlFor={fieldId("note")} wide>
                <textarea
                  id={fieldId("note")}
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
                  canDelete={showDetail && row?.source === "manual"}
                  dirty={dirty}
                  saving={saving}
                  deleting={deleting}
                  onDelete={() => setConfirmDelete(true)}
                />
              ) : null}
            </form>

            {showDetail ? (
              <DetailArea
                detail={detail}
                loading={loading}
                today={today}
                canManage={canManage}
                onChanged={reload}
                invoicesRef={invoicesRef}
              />
            ) : null}

            {showDetail && row ? (
              <div className="border-t pt-4">
                <AuditMeta fallbackCreatedAt={isoOf(row.createdAt)} fallbackUpdatedAt={isoOf(row.updatedAt)} />
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <DiscardDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} onDiscard={() => onOpenChange(false)} />
      <DeleteDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("account.deleteTitle")}
        description={t("account.deleteDescription")}
        pending={deleting}
        onConfirm={remove}
      />
    </>
  );
}

function ResourceStatus({ status }: Readonly<{ status: string }>) {
  const t = useTranslations("vendorBilling");
  if (status === "missing") return <AccountStatusChip status="missing" />;
  return <span className="text-muted-foreground">{status === "active" ? t("status.active") : status}</span>;
}

function DetailSections({
  detail,
  today,
  canManage,
  onChanged,
  invoicesRef,
}: Readonly<{
  detail: Detail;
  today: string;
  canManage: boolean;
  onChanged: () => void;
  invoicesRef: React.RefObject<HTMLDivElement | null>;
}>) {
  const t = useTranslations("vendorBilling");
  const { resources, invoices, costs } = detail;
  return (
    <>
      <section className="space-y-2 border-t pt-4">
        <SectionTitle>
          {t("account.resources")}
          <span className="ml-1.5 font-normal text-muted-foreground">{resources.length}</span>
        </SectionTitle>
        {resources.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty.resources")}</p>
        ) : (
          <div className="min-w-0 overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.label")}</TableHead>
                  <TableHead>ID</TableHead>
                  <TableHead>{t("account.status")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((r) => {
                  const labels = Object.entries(r.labels)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ");
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name ?? "—"}</TableCell>
                      <TableCell className="max-w-56 truncate font-mono text-muted-foreground" title={r.externalId}>
                        {r.externalId}
                      </TableCell>
                      <TableCell>
                        <ResourceStatus status={r.status} />
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground" title={labels}>
                        {labels}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section ref={invoicesRef} className="scroll-mt-4 space-y-1 border-t pt-4">
        <SectionTitle>{t("account.invoices")}</SectionTitle>
        <InvoiceList invoices={invoices} today={today} canManage={canManage} onChanged={onChanged} />
      </section>

      <section className="space-y-2 border-t pt-4">
        <SectionTitle>{t("account.costs")}</SectionTitle>
        {costs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty.costs")}</p>
        ) : (
          <ul className="max-w-sm space-y-1 text-sm">
            {costs.map((c) => (
              <li key={`${c.month}-${c.currency}`} className="flex items-center gap-3">
                <span className="tabular-nums text-muted-foreground">{c.month.slice(0, 7).replace("-", "/")}</span>
                <span className="text-xs text-muted-foreground">{c.currency}</span>
                <span className="ml-auto tabular-nums">{formatCurrency(c.amount, c.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
