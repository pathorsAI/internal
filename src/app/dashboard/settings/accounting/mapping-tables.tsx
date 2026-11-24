"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Landmark, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { StatusTag } from "@/components/ds/status-dot";
import { AccountPicker, type AccountOption } from "@/app/dashboard/accounting/account-picker";
import { setBankAccountLedger, setCategoryGlAccount } from "@/db/ledger-mutations";
import type { LedgerKind } from "@/lib/ledger/types";

type DefaultAccount = { code: string; name: string };

export type BankMappingRow = {
  id: number;
  name: string;
  kind: string;
  currency: string;
  isActive: boolean;
  ledgerScope: LedgerKind;
  glAccountId: number | null;
  defaultAccount: DefaultAccount;
};

export type CategoryMappingRow = {
  id: number;
  name: string;
  kind: string;
  isActive: boolean;
  glAccountId: number | null;
  defaultAccount: DefaultAccount;
};

/**
 * 表格裡就地改、按一次「儲存變更」才送出。改過的列記在 draft，存完 router.refresh() 換成伺服器的值。
 * 每列一個 action：改動通常只有幾列，逐列送比為此多寫一支批次 action 簡單。
 */
function useDraft<R extends { id: number }, V>(rows: R[], valueOf: (r: R) => V, same: (a: V, b: V) => boolean) {
  const [draft, setDraft] = React.useState<Record<number, V>>({});
  const current = (r: R) => (r.id in draft ? draft[r.id] : valueOf(r));
  const changed = rows.filter((r) => r.id in draft && !same(draft[r.id], valueOf(r)));
  const set = (id: number, v: V) => setDraft((prev) => ({ ...prev, [id]: v }));
  return { current, changed, set, reset: () => setDraft({}) };
}

function SaveBar({
  count,
  pending,
  onSave,
  onReset,
}: Readonly<{ count: number; pending: boolean; onSave: () => void; onReset: () => void }>) {
  const t = useTranslations("accounting.common");
  if (count === 0) return null;
  return (
    <span className="flex items-center gap-2">
      <span className="tabular-nums">{t("unsaved", { count })}</span>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onReset}>
        {t("cancel")}
      </Button>
      <Button type="button" size="sm" disabled={pending} onClick={onSave}>
        {pending ? t("saving") : t("saveChanges")}
      </Button>
    </span>
  );
}

async function saveAll<R>(rows: R[], save: (r: R) => Promise<{ ok: boolean; error?: string }>) {
  let saved = 0;
  for (const r of rows) {
    const res = await save(r);
    if (!res.ok) return { saved, error: res.error };
    saved += 1;
  }
  return { saved, error: undefined };
}

export function BankMappingTable({
  rows,
  accounts,
  canManage,
}: Readonly<{ rows: BankMappingRow[]; accounts: AccountOption[]; canManage: boolean }>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [pending, start] = useTransition();
  const { current, changed, set, reset } = useDraft(
    rows,
    (r) => ({ ledgerScope: r.ledgerScope, glAccountId: r.glAccountId }),
    (a, b) => a.ledgerScope === b.ledgerScope && a.glAccountId === b.glAccountId,
  );

  function save() {
    start(async () => {
      const { saved, error } = await saveAll(changed, (r) => setBankAccountLedger(r.id, current(r)));
      // 失敗時留著草稿：已存的那幾列 refresh 後跟伺服器一樣，自然不算未儲存
      if (error) toast.error(error);
      else {
        toast.success(t("settings.banks.saved", { count: saved }));
        reset();
      }
      router.refresh();
    });
  }

  return (
    <TableCard
      title={t("settings.banks.title")}
      action={<SaveBar count={changed.length} pending={pending} onSave={save} onReset={reset} />}
    >
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("settings.banks.hint")}</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings.banks.name")}</TableHead>
              <TableHead>{t("settings.banks.currency")}</TableHead>
              <TableHead>{t("settings.banks.scope")}</TableHead>
              <TableHead className="w-72">{t("settings.banks.glAccount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={4} icon={Landmark} message={t("settings.banks.empty")} />
            ) : (
              rows.map((r) => {
                const v = current(r);
                const government = v.ledgerScope === "government";
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {r.name}
                        {r.isActive ? null : <StatusTag tone="neutral">{t("common.inactive")}</StatusTag>}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.currency}</TableCell>
                    <TableCell>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={government}
                          disabled={!canManage || pending}
                          aria-label={t("settings.banks.governmentVisible")}
                          onCheckedChange={(on) => set(r.id, { ...v, ledgerScope: on ? "government" : "management" })}
                        />
                        <span className={government ? undefined : "text-muted-foreground"}>
                          {t(`ledgerScope.${v.ledgerScope}`)}
                        </span>
                      </label>
                    </TableCell>
                    <TableCell>
                      <AccountPicker
                        accounts={accounts}
                        value={v.glAccountId}
                        onChange={(id) => set(r.id, { ...v, glAccountId: id })}
                        noneLabel={t("common.defaultAccount", r.defaultAccount)}
                        disabled={!canManage || pending}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </TableCard>
  );
}

export function CategoryMappingTable({
  rows,
  accounts,
  canManage,
}: Readonly<{ rows: CategoryMappingRow[]; accounts: AccountOption[]; canManage: boolean }>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [pending, start] = useTransition();
  const { current, changed, set, reset } = useDraft(
    rows,
    (r) => r.glAccountId,
    (a, b) => a === b,
  );

  function save() {
    start(async () => {
      const { saved, error } = await saveAll(changed, (r) => setCategoryGlAccount(r.id, current(r)));
      // 失敗時留著草稿：已存的那幾列 refresh 後跟伺服器一樣，自然不算未儲存
      if (error) toast.error(error);
      else {
        toast.success(t("settings.categories.saved", { count: saved }));
        reset();
      }
      router.refresh();
    });
  }

  const kindLabel = (kind: string) =>
    ["income", "cogs", "expense", "non_operating", "transfer", "equity"].includes(kind)
      ? t(`categoryKind.${kind as "income"}`)
      : kind;

  return (
    <TableCard
      title={t("settings.categories.title")}
      action={<SaveBar count={changed.length} pending={pending} onSave={save} onReset={reset} />}
    >
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("settings.categories.hint")}</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("settings.categories.name")}</TableHead>
              <TableHead>{t("settings.categories.kind")}</TableHead>
              <TableHead className="w-72">{t("settings.categories.glAccount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={3} icon={Tags} message={t("settings.categories.empty")} />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      {r.name}
                      {r.isActive ? null : <StatusTag tone="neutral">{t("common.inactive")}</StatusTag>}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{kindLabel(r.kind)}</TableCell>
                  <TableCell>
                    <AccountPicker
                      accounts={accounts}
                      value={current(r)}
                      onChange={(id) => set(r.id, id)}
                      noneLabel={t("common.defaultAccount", r.defaultAccount)}
                      disabled={!canManage || pending}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </TableCard>
  );
}
