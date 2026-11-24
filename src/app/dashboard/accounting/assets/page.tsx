import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getAccountingSettings, listFixedAssets, listGlAccounts, todayInTaipei } from "@/db/ledger";
import { requireOrg } from "@/lib/session";
import { AccountingNav } from "../accounting-nav";
import { FixedAssetsTable, NewFixedAssetButton } from "./assets-client";

export const dynamic = "force-dynamic";

export default async function FixedAssetsPage() {
  const t = await getTranslations("accounting");
  const { orgId } = await requireOrg();
  const today = todayInTaipei();
  const [assets, accounts, settings] = await Promise.all([
    listFixedAssets(orgId, today),
    listGlAccounts(orgId),
    getAccountingSettings(orgId),
  ]);
  const options = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, isActive: a.isActive }));
  const fallback = accounts.find((a) => a.systemKey === "fixed_asset");
  const defaultAccount = fallback ? { code: fallback.code, name: fallback.name } : null;

  return (
    <>
      <PageHeader title={t("title")}>
        <NewFixedAssetButton accounts={options} defaultAccount={defaultAccount} today={today} />
      </PageHeader>
      <AccountingNav active="assets" />
      <p className="text-sm text-muted-foreground">{t("assets.description")}</p>
      <FixedAssetsTable
        assets={assets}
        accounts={options}
        defaultAccount={defaultAccount}
        today={today}
        currency={settings.functionalCurrency}
      />
    </>
  );
}
