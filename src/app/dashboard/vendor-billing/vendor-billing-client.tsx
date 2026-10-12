"use client";

import * as React from "react";
import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { cn } from "@/lib/utils";
import type { AttentionItem } from "@/lib/vendor-billing/attention";
import type { MatchStatus } from "@/lib/vendor-billing/match";
import type { BillingAccountRow, InvoiceRow, PaymentMethodRow } from "@/lib/vendor-billing/service";
import { reconcileNowAction, syncNowAction } from "./actions";
import { AccountSheet, type AccountSheetTarget } from "./account-sheet";
import { AttentionBanner } from "./attention-banner";
import { PaymentMethodSheet, type MethodSheetTarget } from "./payment-method-sheet";
import { AccountsTable, InvoicesTable, MethodsTable } from "./tables";
import type { BankAccountOption, MemberOption, Option } from "./shared";

const VIEWS = ["accounts", "methods", "invoices"] as const;
export type View = (typeof VIEWS)[number];

const INVOICE_FILTERS = ["all", "pending", "done", "ignored"] as const;
type InvoiceFilter = (typeof INVOICE_FILTERS)[number];
const FILTER_STATUSES: Record<Exclude<InvoiceFilter, "all">, readonly MatchStatus[]> = {
  pending: ["unmatched", "suggested"],
  done: ["matched", "manual", "created"],
  ignored: ["ignored"],
};

/** 小型分段按鈕（不是大 tab bar）。 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: Readonly<{ value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string }>) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-md border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 rounded-sm px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === o.value
              ? "bg-background font-medium text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function filterInvoices(invoices: InvoiceRow[], filter: InvoiceFilter): InvoiceRow[] {
  if (filter === "all") return invoices;
  const allowed = FILTER_STATUSES[filter];
  return invoices.filter((i) => allowed.includes(i.matchStatus));
}

/** 編輯模式的 Sheet 對應到列表上的哪一列（新增模式沒有）。 */
function findRow<T extends { id: number }>(rows: T[], target: { mode: "edit"; id: number } | { mode: "create" }) {
  return target.mode === "edit" ? rows.find((r) => r.id === target.id) : undefined;
}

/** 右上角：立即同步 + 依目前分頁的「新增」。 */
function HeaderActions({
  view,
  syncing,
  onSync,
  onNewAccount,
  onNewMethod,
}: Readonly<{
  view: View;
  syncing: boolean;
  onSync: () => void;
  onNewAccount: () => void;
  onNewMethod: () => void;
}>) {
  const t = useTranslations("vendorBilling");
  return (
    <>
      <Button type="button" variant="outline" onClick={onSync} disabled={syncing}>
        <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
        {syncing ? t("actions.syncing") : t("actions.syncNow")}
      </Button>
      {view === "accounts" ? (
        <Button type="button" onClick={onNewAccount}>
          <Plus className="size-4" /> {t("actions.newAccount")}
        </Button>
      ) : null}
      {view === "methods" ? (
        <Button type="button" onClick={onNewMethod}>
          <Plus className="size-4" /> {t("actions.newMethod")}
        </Button>
      ) : null}
    </>
  );
}

function InvoiceToolbar({
  filter,
  onFilter,
  canManage,
  reconciling,
  onReconcile,
}: Readonly<{
  filter: InvoiceFilter;
  onFilter: (f: InvoiceFilter) => void;
  canManage: boolean;
  reconciling: boolean;
  onReconcile: () => void;
}>) {
  const t = useTranslations("vendorBilling");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Segmented
        label={t("columns.matchStatus")}
        value={filter}
        onChange={onFilter}
        options={INVOICE_FILTERS.map((f) => ({ value: f, label: t(`invoiceFilter.${f}`) }))}
      />
      {canManage ? (
        <Button type="button" size="sm" variant="outline" onClick={onReconcile} disabled={reconciling}>
          {reconciling ? t("actions.reconciling") : t("actions.reconcile")}
        </Button>
      ) : null}
    </div>
  );
}

function ViewTable({
  view,
  today,
  accounts,
  methods,
  invoices,
  onOpenAccount,
  onOpenMethod,
}: Readonly<{
  view: View;
  today: string;
  accounts: BillingAccountRow[];
  methods: PaymentMethodRow[];
  invoices: InvoiceRow[];
  onOpenAccount: (id: number, focusInvoices?: boolean) => void;
  onOpenMethod: (id: number) => void;
}>) {
  if (view === "methods") return <MethodsTable rows={methods} today={today} onOpen={onOpenMethod} />;
  if (view === "invoices") {
    return <InvoicesTable rows={invoices} today={today} onOpen={(id) => onOpenAccount(id, true)} />;
  }
  return <AccountsTable rows={accounts} today={today} onOpen={(id) => onOpenAccount(id)} />;
}

export function VendorBillingClient({
  initialView,
  canManage,
  today,
  accounts,
  methods,
  invoices,
  attention,
  parties,
  bankAccounts,
  members,
}: Readonly<{
  initialView: View;
  canManage: boolean;
  /** 台北日期 YYYY-MM-DD（server 算，卡片到期判斷用，避免 server / client 結果不同） */
  today: string;
  accounts: BillingAccountRow[];
  methods: PaymentMethodRow[];
  invoices: InvoiceRow[];
  attention: AttentionItem[];
  parties: Option[];
  bankAccounts: BankAccountOption[];
  members: MemberOption[];
}>) {
  const t = useTranslations("vendorBilling");
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = React.useState<View>(initialView);
  const [invoiceFilter, setInvoiceFilter] = React.useState<InvoiceFilter>("all");

  // Sheet：target 換 nonce 就是一張乾淨的表單；關閉時元件留著讓收合動畫跑完。
  const [accountTarget, setAccountTarget] = React.useState<AccountSheetTarget | null>(null);
  const [accountOpen, setAccountOpen] = React.useState(false);
  const [methodTarget, setMethodTarget] = React.useState<MethodSheetTarget | null>(null);
  const [methodOpen, setMethodOpen] = React.useState(false);

  const [syncing, startSync] = useTransition();
  const [reconciling, startReconcile] = useTransition();

  function changeView(next: View) {
    setView(next);
    router.replace(next === "accounts" ? pathname : `${pathname}?view=${next}`, { scroll: false });
  }

  function openAccount(id: number, focusInvoices = false) {
    setAccountTarget((prev) => ({ mode: "edit", id, focusInvoices, nonce: (prev?.nonce ?? 0) + 1 }));
    setAccountOpen(true);
  }
  function newAccount() {
    setAccountTarget((prev) => ({ mode: "create", nonce: (prev?.nonce ?? 0) + 1 }));
    setAccountOpen(true);
  }
  function openMethod(id: number) {
    setMethodTarget((prev) => ({ mode: "edit", id, nonce: (prev?.nonce ?? 0) + 1 }));
    setMethodOpen(true);
  }
  function newMethod() {
    setMethodTarget((prev) => ({ mode: "create", nonce: (prev?.nonce ?? 0) + 1 }));
    setMethodOpen(true);
  }

  function syncNow() {
    startSync(async () => {
      const res = await syncNowAction();
      if (!res.ok) {
        toast.error(res.error ?? t("toast.failed"));
        return;
      }
      toast.success(t("toast.synced"), {
        description: <span className="whitespace-pre-line">{res.message}</span>,
      });
    });
  }

  function reconcileNow() {
    startReconcile(async () => {
      const res = await reconcileNowAction();
      if (!res.ok) toast.error(res.error ?? t("toast.failed"));
      else toast.success(t("toast.reconciled"), { description: res.message });
    });
  }

  const providers = React.useMemo(() => new Map(accounts.map((a) => [a.id, a.provider])), [accounts]);
  const shownInvoices = React.useMemo(() => filterInvoices(invoices, invoiceFilter), [invoices, invoiceFilter]);


  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        {canManage ? (
          <HeaderActions view={view} syncing={syncing} onSync={syncNow} onNewAccount={newAccount} onNewMethod={newMethod} />
        ) : null}
      </PageHeader>

      <AttentionBanner
        items={attention}
        providers={providers}
        canManage={canManage}
        onOpenAccount={(id) => openAccount(id)}
        onOpenMethod={openMethod}
        onOpenPendingInvoices={() => {
          setInvoiceFilter("pending");
          changeView("invoices");
        }}
      />

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Segmented
          label={t("title")}
          value={view}
          onChange={changeView}
          options={VIEWS.map((v) => ({ value: v, label: t(`views.${v}`) }))}
        />
        {view === "invoices" ? (
          <InvoiceToolbar
            filter={invoiceFilter}
            onFilter={setInvoiceFilter}
            canManage={canManage}
            reconciling={reconciling}
            onReconcile={reconcileNow}
          />
        ) : null}
      </div>

      <ViewTable
        view={view}
        today={today}
        accounts={accounts}
        methods={methods}
        invoices={shownInvoices}
        onOpenAccount={openAccount}
        onOpenMethod={openMethod}
      />

      {accountTarget ? (
        <AccountSheet
          key={accountTarget.nonce}
          target={accountTarget}
          row={findRow(accounts, accountTarget)}
          open={accountOpen}
          onOpenChange={setAccountOpen}
          canManage={canManage}
          today={today}
          parties={parties}
          methods={methods}
          members={members}
        />
      ) : null}
      {methodTarget ? (
        <PaymentMethodSheet
          key={methodTarget.nonce}
          target={methodTarget}
          row={findRow(methods, methodTarget)}
          open={methodOpen}
          onOpenChange={setMethodOpen}
          canManage={canManage}
          today={today}
          bankAccounts={bankAccounts}
        />
      ) : null}
    </>
  );
}
