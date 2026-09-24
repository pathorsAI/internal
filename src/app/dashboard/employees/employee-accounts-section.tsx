"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox } from "@/components/combobox";
import { CopyButton } from "@/components/copy-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CURRENCIES } from "@/lib/currency";
import {
  EMPLOYEE_ACCOUNT_KINDS,
  TW_BANKS,
  bankNameForCode,
  type MaskedEmployeeAccount,
} from "@/lib/employee-accounts";
import {
  convertLegacySalaryAccountAction,
  deleteEmployeeAccount,
  revealEmployeeAccount,
  saveEmployeeAccount,
  type EmployeeAccountFormInput,
} from "./account-actions";

/**
 * 員工編輯表單裡的「帳戶」區塊。
 *
 * 這個區塊渲染在員工表單（<form>）裡面，而 HTML 不能巢狀 <form>，所以：
 * - 輸入框一律不給 name，不會混進員工表單送出的 FormData
 * - 帳戶有自己的「儲存」按鈕（type="button"），直接用物件呼叫 server action
 * - 在帳戶輸入框按 Enter 不會觸發員工表單送出
 *
 * 列表只拿得到遮罩後的資料；完整帳號只有 owner / admin 按「顯示完整帳號」才會
 * 向 server 要一次（每次都會寫入操作紀錄），也只存在這個元件的 state 裡。
 */

const BANK_OPTIONS = TW_BANKS.map((b) => `${b.code} ${b.name}`);

type Draft = Omit<EmployeeAccountFormInput, "employeeId"> & { bankInput: string };

function emptyDraft(holder: string, isFirst: boolean): Draft {
  return {
    id: null,
    kind: "bank",
    bankInput: "",
    bankCode: "",
    branchCode: "",
    bankName: "",
    accountHolder: holder,
    accountNumber: "",
    currency: "TWD",
    label: "",
    // 第一個帳戶預設就是薪資與報銷的預設帳戶，省得再勾
    defaultForSalary: isFirst,
    defaultForReimbursement: isFirst,
    isActive: true,
    note: "",
  };
}

function draftFrom(a: MaskedEmployeeAccount): Draft {
  return {
    id: a.id,
    kind: a.kind,
    bankInput: a.bankCode ? `${a.bankCode} ${a.bankName ?? ""}`.trim() : "",
    bankCode: a.bankCode ?? "",
    branchCode: a.branchCode ?? "",
    bankName: a.bankName ?? "",
    accountHolder: a.accountHolder ?? "",
    accountNumber: "",
    currency: a.currency,
    label: a.label ?? "",
    defaultForSalary: a.defaultForSalary,
    defaultForReimbursement: a.defaultForReimbursement,
    isActive: a.isActive,
    note: a.note ?? "",
  };
}

/** 銀行欄位的自由輸入 → 代碼與名稱。開頭 3 碼數字就是代碼，其餘文字當名稱。 */
function parseBankInput(v: string): { bankCode: string; bankName: string } {
  const m = /^\s*(\d{3})\s*(.*)$/.exec(v);
  if (!m) return { bankCode: "", bankName: v.trim() };
  return { bankCode: m[1], bankName: m[2].trim() || (bankNameForCode(m[1]) ?? "") };
}

/** 在帳戶輸入框按 Enter 不要送出外層的員工表單。 */
function swallowEnter(e: React.KeyboardEvent) {
  if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
}

export function EmployeeAccountsSection({
  employeeId,
  employeeName,
  accounts,
  canManage,
  legacySalaryAccount,
}: Readonly<{
  employeeId: number;
  employeeName: string;
  accounts: MaskedEmployeeAccount[];
  canManage: boolean;
  /** 舊 salary_account（已遮罩）；只有還沒有任何帳戶時才會傳進來 */
  legacySalaryAccount: string | null;
}>) {
  const t = useTranslations("employees.accounts");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();

  function save() {
    if (!draft) return;
    const { bankInput, ...rest } = draft;
    const bank = draft.kind === "bank" ? parseBankInput(bankInput) : { bankCode: "", bankName: draft.bankName };
    start(async () => {
      const res = await saveEmployeeAccount({ ...rest, ...bank, employeeId });
      if (res.ok) {
        toast.success(draft.id ? t("toast.updated") : t("toast.created"));
        setDraft(null);
      } else if (res.error) {
        toast.error(res.error);
      }
    });
  }

  function convertLegacy() {
    start(async () => {
      const res = await convertLegacySalaryAccountAction(employeeId);
      if (res.ok) toast.success(t("toast.converted"));
      else if (res.error) toast.error(res.error);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border p-3 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{t("title")}</div>
        {canManage && !draft ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setDraft(emptyDraft(employeeName, accounts.length === 0))}
          >
            <Plus className="size-3.5" /> {t("add")}
          </Button>
        ) : null}
      </div>

      {legacySalaryAccount && accounts.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {t("legacy.notice", { value: legacySalaryAccount })}
          </span>
          {canManage ? (
            <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={convertLegacy}>
              {t("legacy.convert")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {accounts.length === 0 && !legacySalaryAccount ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : null}

      <ul className="divide-y rounded-md border empty:hidden">
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            canManage={canManage}
            editing={draft?.id === a.id}
            onEdit={() => setDraft(draftFrom(a))}
          />
        ))}
      </ul>

      {draft ? (
        <AccountForm
          draft={draft}
          setDraft={setDraft}
          pending={pending}
          onSave={save}
          onCancel={() => setDraft(null)}
        />
      ) : null}
    </div>
  );
}

function AccountRow({
  account: a,
  canManage,
  editing,
  onEdit,
}: Readonly<{
  account: MaskedEmployeeAccount;
  canManage: boolean;
  editing: boolean;
  onEdit: () => void;
}>) {
  const t = useTranslations("employees.accounts");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reveal() {
    start(async () => {
      const res = await revealEmployeeAccount(a.id);
      if (res.ok) setRevealed(res.accountNumber);
      else toast.error(res.error);
    });
  }

  // 「永豐銀行 807 · 0180 分行 · •••• 90123 · TWD」
  const head = [a.bankName ?? t(`kind.${a.kind as "bank" | "wise" | "other"}`), a.bankCode]
    .filter(Boolean)
    .join(" ");
  const parts = [
    head,
    a.branchCode ? t("branchSuffix", { code: a.branchCode }) : null,
    `•••• ${a.accountLast5}`,
    a.currency,
  ].filter(Boolean);

  return (
    <li className={editing ? "bg-muted/50 px-3 py-2" : "px-3 py-2"}>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className={a.isActive ? "tabular-nums" : "tabular-nums text-muted-foreground"}>
          {parts.join(" · ")}
        </span>
        {a.defaultForSalary ? <Badge variant="secondary" className="font-normal">{t("chips.salary")}</Badge> : null}
        {a.defaultForReimbursement ? (
          <Badge variant="secondary" className="font-normal">{t("chips.reimbursement")}</Badge>
        ) : null}
        {a.isActive ? null : <Badge variant="outline" className="font-normal">{t("chips.inactive")}</Badge>}
      </div>
      {a.accountHolder || a.label || a.note ? (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {[a.accountHolder, a.label, a.note].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      {revealed ? (
        <div className="mt-1.5 flex items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-sm tabular-nums">{revealed}</code>
          <CopyButton value={revealed} label="" className="size-7" />
          <Button type="button" size="sm" variant="ghost" onClick={() => setRevealed(null)}>
            <EyeOff className="size-3.5" /> {t("hide")}
          </Button>
        </div>
      ) : null}
      {canManage ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {revealed ? null : (
            <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reveal}>
              <Eye className="size-3.5" /> {t("reveal")}
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3.5" /> {t("edit")}
          </Button>
          <DeleteAccountButton id={a.id} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * 刪除確認。不用共用的 DeleteButton：那顆刪除成功後會把整個員工編輯面板關掉，
 * 這裡只是刪掉面板裡的一列。
 */
function DeleteAccountButton({ id }: Readonly<{ id: number }>) {
  const t = useTranslations("employees.accounts");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function onConfirm() {
    start(async () => {
      const res = await deleteEmployeeAccount(id);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toast.deleted"));
      } else if (res.error) {
        toast.error(res.error);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="text-destructive">
          <Trash2 className="size-3.5" /> {t("delete")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("deleteConfirm.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("deleteConfirm.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            disabled={pending}
          >
            {t("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AccountForm({
  draft,
  setDraft,
  pending,
  onSave,
  onCancel,
}: Readonly<{
  draft: Draft;
  setDraft: (d: Draft) => void;
  pending: boolean;
  onSave: () => void;
  onCancel: () => void;
}>) {
  const t = useTranslations("employees.accounts");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const isBank = draft.kind === "bank";
  const currencyCodes = useMemo(() => {
    const codes = CURRENCIES.map((c) => c.code);
    return codes.includes(draft.currency) ? codes : [draft.currency, ...codes];
  }, [draft.currency]);

  return (
    // 攔 Enter：這塊在員工表單裡面，按 Enter 會把整張員工表單送出去。
    // 這個 div 本身不可互動，只是接住內層輸入框冒泡上來的 keydown（事件委派），
    // 所以標 role="presentation"（jsx-a11y 對「接冒泡事件的容器」建議的做法）。
    <div role="presentation" className="space-y-3 rounded-md border bg-muted/30 p-3" onKeyDown={swallowEnter}>
      <div className="text-sm font-medium">{draft.id ? t("form.editTitle") : t("form.addTitle")}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow label={t("form.kind")}>
          <Select value={draft.kind} onValueChange={(v) => set("kind", v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYEE_ACCOUNT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`kind.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
        {isBank ? (
          <FormRow label={t("form.bank")} required>
            <Combobox
              items={BANK_OPTIONS}
              value={draft.bankInput}
              onValueChange={(v) => set("bankInput", v)}
              placeholder={t("form.bankPlaceholder")}
              emptyText={t("form.bankFreeEntry")}
            />
          </FormRow>
        ) : (
          <FormRow label={t("form.providerName")}>
            <Input
              value={draft.bankName}
              onChange={(e) => set("bankName", e.target.value)}
              placeholder={draft.kind === "wise" ? "Wise" : t("form.optional")}
            />
          </FormRow>
        )}
        {isBank ? (
          <FormRow label={t("form.branchCode")}>
            <Input
              value={draft.branchCode}
              onChange={(e) => set("branchCode", e.target.value)}
              inputMode="numeric"
              maxLength={4}
              placeholder={t("form.branchPlaceholder")}
            />
          </FormRow>
        ) : null}
        <FormRow label={t("form.holder")}>
          <Input value={draft.accountHolder} onChange={(e) => set("accountHolder", e.target.value)} />
        </FormRow>
        <FormRow label={t("form.number")} required={!draft.id}>
          <Input
            value={draft.accountNumber}
            onChange={(e) => set("accountNumber", e.target.value)}
            inputMode={isBank ? "numeric" : "text"}
            autoComplete="off"
            placeholder={draft.id ? t("form.numberKeep") : t("form.numberPlaceholder")}
          />
        </FormRow>
        <FormRow label={t("form.currency")}>
          <Select value={draft.currency} onValueChange={(v) => set("currency", v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencyCodes.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
        <FormRow label={t("form.label")}>
          <Input
            value={draft.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder={t("form.labelPlaceholder")}
          />
        </FormRow>
        <FormRow label={t("form.note")}>
          <Input value={draft.note} onChange={(e) => set("note", e.target.value)} placeholder={t("form.optional")} />
        </FormRow>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <CheckRow
          checked={draft.defaultForSalary}
          onChange={(v) => set("defaultForSalary", v)}
          label={t("form.defaultForSalary")}
          disabled={!draft.isActive}
        />
        <CheckRow
          checked={draft.defaultForReimbursement}
          onChange={(v) => set("defaultForReimbursement", v)}
          label={t("form.defaultForReimbursement")}
          disabled={!draft.isActive}
        />
        {draft.id ? (
          <CheckRow checked={draft.isActive} onChange={(v) => set("isActive", v)} label={t("form.isActive")} />
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="button" size="sm" disabled={pending} onClick={onSave}>
          {pending ? t("form.saving") : t("form.save")}
        </Button>
      </div>
    </div>
  );
}

function FormRow({
  label,
  required,
  children,
}: Readonly<{ label: string; required?: boolean; children: React.ReactNode }>) {
  return (
    // 用 div 而不是 <label>：裡面的 Combobox / Select 自己處理焦點
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  disabled,
}: Readonly<{ checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }>) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
      <span>{label}</span>
    </label>
  );
}
