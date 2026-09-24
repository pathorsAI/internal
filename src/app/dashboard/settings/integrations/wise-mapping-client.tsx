"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyFlag } from "@/components/currency-flag";
import { formatCurrency } from "@/lib/currency";
import { refreshWiseBalancesAction, saveWiseMappingsAction } from "./wise-actions";

/** 一個 Wise 餘額 + 目前的對應（server 已整理好，不含任何憑證）。 */
export type WiseBalanceRow = {
  profileId: number;
  profileName: string;
  balanceId: number;
  currency: string;
  amount: number | null;
  /** 已格式化的時間字串。 */
  fetchedAt: string | null;
  bankAccountId: number | null;
  syncFrom: string | null;
};

export type WiseLedgerAccount = { id: number; name: string; currency: string };

const NONE = "none";

export function WiseMappingSection({
  balances,
  accounts,
  suggestions,
  canManage,
  enabled,
}: Readonly<{
  balances: WiseBalanceRow[];
  accounts: WiseLedgerAccount[];
  /** 帳本帳戶 id → 建議切換日。 */
  suggestions: Record<number, string>;
  canManage: boolean;
  /** 整合是否已開啟（重新整理餘額要打 Wise，必須開啟）。 */
  enabled: boolean;
}>) {
  const t = useTranslations("wise");
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(() =>
    balances.map((b) => ({
      key: `${b.profileId}:${b.balanceId}`,
      bankAccountId: b.bankAccountId,
      syncFrom: b.syncFrom ?? "",
    })),
  );
  const dirty = rows.some((r, i) => {
    const b = balances[i];
    return r.bankAccountId !== b.bankAccountId || r.syncFrom !== (b.syncFrom ?? "");
  });

  function update(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function save() {
    start(async () => {
      const res = await saveWiseMappingsAction(
        balances.map((b, i) => ({
          profileId: b.profileId,
          balanceId: b.balanceId,
          bankAccountId: rows[i].bankAccountId,
          syncFrom: rows[i].syncFrom || null,
        })),
      );
      if (res.ok) toast.success(t("mapping.saved"));
      else toast.error(res.error ?? t("errors.failed"));
    });
  }

  function refresh() {
    start(async () => {
      const res = await refreshWiseBalancesAction();
      if (res.ok) toast.success(t("mapping.refreshed"));
      else toast.error(res.error ?? t("errors.failed"));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowLeftRight className="size-4" />
          {t("mapping.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-prose text-sm text-muted-foreground">{t("mapping.description")}</p>
        {canManage ? null : (
          <p className="text-xs text-muted-foreground">{t("mapping.readOnly")}</p>
        )}

        {balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("mapping.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t("mapping.columns.balance")}</th>
                  <th className="py-2 pr-3 font-medium">{t("mapping.columns.account")}</th>
                  <th className="py-2 font-medium">{t("mapping.columns.syncFrom")}</th>
                </tr>
              </thead>
              <tbody>
                {balances.map((b, i) => {
                  const r = rows[i];
                  const options = accounts.filter(
                    (a) => a.currency.trim().toUpperCase() === b.currency,
                  );
                  const suggestion = r.bankAccountId ? suggestions[r.bankAccountId] : undefined;
                  return (
                    <tr key={r.key} className="border-b last:border-0 align-top">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2 font-medium">
                          <CurrencyFlag currency={b.currency} />
                          {b.profileName} · {b.currency}
                        </div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {b.amount === null ? "—" : formatCurrency(b.amount, b.currency)}
                          {b.fetchedAt ? ` · ${t("mapping.asOf", { date: b.fetchedAt })}` : null}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        {options.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            {t("mapping.noAccounts", { currency: b.currency })}
                          </span>
                        ) : (
                          <Select
                            value={r.bankAccountId ? String(r.bankAccountId) : NONE}
                            onValueChange={(v) => {
                              const id = v === NONE ? null : Number(v);
                              update(i, {
                                bankAccountId: id,
                                syncFrom: r.syncFrom || (id ? (suggestions[id] ?? "") : ""),
                              });
                            }}
                            disabled={!canManage || pending}
                          >
                            <SelectTrigger className="w-56">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>{t("mapping.unmapped")}</SelectItem>
                              {options.map((a) => (
                                <SelectItem key={a.id} value={String(a.id)}>
                                  {a.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="py-3">
                        <Input
                          type="date"
                          className="w-44"
                          value={r.syncFrom}
                          onChange={(e) => update(i, { syncFrom: e.target.value })}
                          disabled={!canManage || pending || !r.bankAccountId}
                          aria-label={t("mapping.columns.syncFrom")}
                        />
                        {suggestion && suggestion !== r.syncFrom ? (
                          <button
                            type="button"
                            className="mt-1 block text-xs text-muted-foreground underline-offset-2 hover:underline disabled:no-underline"
                            onClick={() => update(i, { syncFrom: suggestion })}
                            disabled={!canManage || pending}
                          >
                            {t("mapping.suggestion", { date: suggestion })}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("mapping.suggestionHint")}</p>

        {canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {enabled ? null : (
              <span className="mr-auto text-xs text-muted-foreground">
                {t("mapping.refreshNeedsEnabled")}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={pending || !enabled}
            >
              <RefreshCw className="size-4" /> {t("mapping.refresh")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={pending || !dirty || balances.length === 0}
            >
              <Save className="size-4" /> {pending ? t("mapping.saving") : t("mapping.save")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
