import { listBankAccounts } from "@/db/queries";
import { formatDateTime } from "@/lib/format";
import type { IntegrationSummary } from "@/lib/integrations/types";
import { parseWiseConfig, suggestSyncFrom } from "@/lib/wise-sync";
import type { WiseBalanceRow, WiseLedgerAccount } from "./wise-mapping-client";

/** 設定頁 Wise 帳戶對應區塊要的資料（只有非機密的 config 與本組織的帳戶）。 */
export async function loadWiseMappingView(orgId: string, summary: IntegrationSummary) {
  const cfg = parseWiseConfig(summary.config);
  const accountsAll = await listBankAccounts(orgId);
  const accounts: WiseLedgerAccount[] = accountsAll
    .filter((a) => a.isActive)
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency.trim().toUpperCase() }));
  const currencies = new Set(cfg.balances.map((b) => b.currency));
  const candidateIds = accounts.filter((a) => currencies.has(a.currency)).map((a) => a.id);
  const suggestionMap = await suggestSyncFrom(orgId, candidateIds);
  const profileName = (id: number) => cfg.profiles.find((p) => p.id === id)?.name ?? String(id);
  const balances: WiseBalanceRow[] = cfg.balances.map((b) => {
    const m = cfg.accountMappings.find((x) => x.balanceId === b.balanceId);
    return {
      profileId: b.profileId,
      profileName: profileName(b.profileId),
      balanceId: b.balanceId,
      currency: b.currency,
      amount: b.amount,
      fetchedAt: b.fetchedAt ? formatDateTime(b.fetchedAt) : null,
      bankAccountId: m?.bankAccountId ?? null,
      syncFrom: m?.syncFrom ?? null,
    };
  });
  return {
    // 餘額清單或已存的對應變了（重新整理 / 儲存）就重掛元件，讓表單回到存檔後的狀態。
    key: JSON.stringify([cfg.balances.map((b) => b.balanceId), cfg.accountMappings]),
    balances,
    accounts,
    suggestions: Object.fromEntries(suggestionMap) as Record<number, string>,
    enabled: summary.enabled && summary.status === "connected",
  };
}
