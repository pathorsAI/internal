"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/table-card";
import { StatusTag } from "@/components/ds/status-dot";
import { Field } from "@/components/form-field";
import { createGlAccount, updateGlAccount } from "@/db/ledger-mutations";
import type { SectionDef } from "@/lib/ledger/module";
import type { CashFlowClass, GlAccount, GlAccountType } from "@/lib/ledger/types";

const TYPES: GlAccountType[] = ["asset", "liability", "equity", "revenue", "expense"];
const CASH_FLOWS: CashFlowClass[] = ["cash", "operating", "investing", "financing", "none"];
const isBalanceSheet = (type: GlAccountType) => type === "asset" || type === "liability" || type === "equity";

type Form = {
  code: string;
  name: string;
  nameEn: string;
  type: GlAccountType;
  section: string;
  cashFlow: CashFlowClass;
  isActive: boolean;
};

function formOf(a: GlAccount | null, sections: SectionDef[]): Form {
  if (a) {
    return {
      code: a.code,
      name: a.name,
      nameEn: a.nameEn ?? "",
      type: a.type,
      section: a.section,
      cashFlow: a.cashFlow,
      isActive: a.isActive,
    };
  }
  return {
    code: "",
    name: "",
    nameEn: "",
    type: "expense",
    section: sections.find((s) => s.key === "operating_expense")?.key ?? sections[0]?.key ?? "",
    cashFlow: "operating",
    isActive: true,
  };
}

function AccountSheet({
  account,
  open,
  onOpenChange,
  sections,
}: Readonly<{
  account: GlAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: SectionDef[];
}>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [form, setForm] = React.useState<Form>(() => formOf(account, sections));
  const [pending, start] = useTransition();
  const system = !!account?.systemKey;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((prev) => ({ ...prev, [k]: v }));
  const allowedSections = sections.filter((s) => (s.statement === "balance_sheet") === isBalanceSheet(form.type));

  function changeType(type: GlAccountType) {
    setForm((prev) => {
      const ok = sections.some((s) => s.key === prev.section && (s.statement === "balance_sheet") === isBalanceSheet(type));
      const section = ok
        ? prev.section
        : (sections.find((s) => (s.statement === "balance_sheet") === isBalanceSheet(type))?.key ?? prev.section);
      return { ...prev, type, section };
    });
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    start(async () => {
      const input = {
        code: form.code,
        name: form.name,
        nameEn: form.nameEn || null,
        type: form.type,
        section: form.section,
        cashFlow: form.cashFlow,
      };
      const res = account ? await updateGlAccount(account.id, { ...input, isActive: form.isActive }) : await createGlAccount(input);
      if (!res.ok) {
        toast.error(res.error ?? t("errors.saveFailed"));
        return;
      }
      toast.success(account ? t("settings.chart.updated") : t("settings.chart.created"));
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader className="shrink-0 border-b pr-10">
          <SheetTitle className="flex items-center gap-2">
            {account ? t("settings.chart.editTitle") : t("settings.chart.newTitle")}
            {system ? <StatusTag tone="primary">{t("settings.chart.system")}</StatusTag> : null}
          </SheetTitle>
          <SheetDescription className={system ? "text-xs" : "sr-only"}>
            {system ? t("settings.chart.systemHint") : t("settings.chart.newTitle")}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col" autoComplete="off">
          <div className="grid flex-1 content-start gap-4 overflow-y-auto px-4 pb-6 sm:grid-cols-2">
            <Field label={t("settings.chart.code")} htmlFor="gl-code" required>
              <Input
                id="gl-code"
                value={form.code}
                required
                inputMode="numeric"
                className="tabular-nums"
                onChange={(e) => set("code", e.target.value)}
              />
            </Field>
            <Field label={t("settings.chart.type")}>
              <Select value={form.type} onValueChange={(v) => changeType(v as GlAccountType)} disabled={system}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((ty) => (
                    <SelectItem key={ty} value={ty}>
                      {t(`glType.${ty}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("settings.chart.name")} htmlFor="gl-name" required wide>
              <Input id="gl-name" value={form.name} required onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label={t("settings.chart.nameEn")} htmlFor="gl-name-en" wide>
              <Input id="gl-name-en" value={form.nameEn} onChange={(e) => set("nameEn", e.target.value)} />
            </Field>
            <Field label={t("settings.chart.section")}>
              <Select value={form.section} onValueChange={(v) => set("section", v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedSections.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {t(`sections.${s.key as "equity"}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("settings.chart.cashFlow")}>
              <Select value={form.cashFlow} onValueChange={(v) => set("cashFlow", v as CashFlowClass)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASH_FLOWS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`cashFlow.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {account ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <Switch checked={form.isActive} disabled={system} onCheckedChange={(v) => set("isActive", v)} />
                {t("settings.chart.active")}
              </label>
            ) : null}
          </div>
          <SheetFooter className="shrink-0 flex-row justify-end border-t">
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** 科目表：依類別分組，點一列在 Sheet 裡編輯。 */
export function ChartOfAccounts({
  accounts,
  sections,
  canManage,
}: Readonly<{ accounts: GlAccount[]; sections: SectionDef[]; canManage: boolean }>) {
  const t = useTranslations("accounting");
  const [target, setTarget] = React.useState<{ account: GlAccount | null; nonce: number } | null>(null);
  const [open, setOpen] = React.useState(false);
  const openSheet = (account: GlAccount | null) => {
    setTarget({ account, nonce: Date.now() });
    setOpen(true);
  };
  const sectionLabel = (key: string) =>
    sections.some((s) => s.key === key) ? t(`sections.${key as "equity"}`) : key;

  return (
    <>
      <TableCard
        title={t("settings.chart.title")}
        action={
          <span className="flex items-center gap-3">
            <span className="tabular-nums">{t("settings.chart.count", { count: accounts.length })}</span>
            {canManage ? (
              <Button type="button" variant="outline" size="sm" onClick={() => openSheet(null)}>
                <Plus className="size-4" /> {t("settings.chart.add")}
              </Button>
            ) : null}
          </span>
        }
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">{t("settings.chart.code")}</TableHead>
                <TableHead>{t("settings.chart.name")}</TableHead>
                <TableHead>{t("settings.chart.section")}</TableHead>
                <TableHead>{t("settings.chart.cashFlow")}</TableHead>
              </TableRow>
            </TableHeader>
            {TYPES.map((type) => {
              const list = accounts.filter((a) => a.type === type);
              if (list.length === 0) return null;
              return (
                <TableBody key={type}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={4} className="py-1.5 text-xs font-medium text-muted-foreground">
                      {t(`glType.${type}`)}
                    </TableCell>
                  </TableRow>
                  {list.map((a) => (
                    <TableRow
                      key={a.id}
                      className={canManage ? "cursor-pointer" : undefined}
                      onClick={canManage ? () => openSheet(a) : undefined}
                    >
                      <TableCell className="font-mono text-xs tabular-nums">{a.code}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className={a.isActive ? undefined : "text-muted-foreground"}>{a.name}</span>
                          {a.systemKey ? <Lock aria-label={t("settings.chart.system")} className="size-3 text-muted-foreground" /> : null}
                          {a.isActive ? null : <StatusTag tone="neutral">{t("common.inactive")}</StatusTag>}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{sectionLabel(a.section)}</TableCell>
                      <TableCell className="text-muted-foreground">{t(`cashFlow.${a.cashFlow}`)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              );
            })}
          </Table>
        </div>
      </TableCard>
      {target ? (
        <AccountSheet
          key={target.nonce}
          account={target.account}
          open={open}
          onOpenChange={setOpen}
          sections={sections}
        />
      ) : null}
    </>
  );
}
