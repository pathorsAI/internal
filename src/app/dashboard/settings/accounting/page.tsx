import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getAccountingSettings, hasJournalData, listGlAccounts, listMappingSources } from "@/db/ledger";
import { getJurisdiction, JURISDICTION_CODES } from "@/lib/ledger/jurisdictions";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { SettingsBody } from "../settings-body";
import { AccountingSettingsForm } from "./settings-form";
import { BankMappingTable, CategoryMappingTable } from "./mapping-tables";
import { ChartOfAccounts } from "./chart-of-accounts";

export const dynamic = "force-dynamic";

export default async function AccountingSettingsPage() {
  const t = await getTranslations("accounting.settings");
  const { orgId, role } = await requireOrgWithRole();
  const canManage = canManageOrg(role);
  const [settings, accounts, sources, locked] = await Promise.all([
    getAccountingSettings(orgId),
    listGlAccounts(orgId),
    listMappingSources(orgId),
    hasJournalData(orgId),
  ]);
  const mod = getJurisdiction(settings.jurisdiction);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const capital = accounts.find((a) => a.systemKey === "capital") ?? null;

  // 沒指定科目時模組會對到哪一個（畫面上顯示「預設：…」）
  const defaultLabel = (code: string) => {
    const acc = byCode.get(code);
    return acc ? { code: acc.code, name: acc.name } : { code, name: "" };
  };
  const banks = sources.bankAccounts.map((b) => ({
    ...b,
    defaultAccount: defaultLabel(mod.defaultBankAccountCode(b, settings.functionalCurrency)),
  }));
  const categories = sources.categories.map((c) => ({
    ...c,
    defaultAccount: defaultLabel(mod.defaultCategoryCode(c)),
  }));
  const accountOptions = accounts.map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    isActive: a.isActive,
  }));

  return (
    <>
      <PageHeader title={t("title")} />
      <SettingsBody>
        <AccountingSettingsForm
          settings={settings}
          canManage={canManage}
          jurisdictionLocked={locked}
          jurisdictions={JURISDICTION_CODES}
          frameworks={mod.frameworks}
          accounts={accountOptions}
          capital={capital ? { code: capital.code, name: capital.name } : null}
        />
        <BankMappingTable rows={banks} accounts={accountOptions} canManage={canManage} />
        <CategoryMappingTable rows={categories} accounts={accountOptions} canManage={canManage} />
        <ChartOfAccounts accounts={accounts} sections={mod.sections} canManage={canManage} />
      </SettingsBody>
    </>
  );
}
