import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteBankAccount } from "@/db/mutations";
import { EditBankAccountForm } from "./edit-bank-account-form";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/ds/status-dot";
import { Amount } from "@/components/amount";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAccountBalances } from "@/db/queries";
import { CurrencyFlag } from "@/components/currency-flag";
import { NewBankAccountDialog } from "./new-bank-account-dialog";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { getIntegration } from "@/lib/integrations/store";
import { parseWiseConfig } from "@/lib/wise-sync";
import { WiseSyncButton } from "./wise-sync-sheet";
import { SinopacImportButton } from "./sinopac-import-sheet";

export const dynamic = "force-dynamic";

/**
 * 餘額不帶正負號；只有變成負數（透支、記錯帳）時帶「−」並標紅 —— 那是要有人去處理的。
 */
function Balance({ value, currency }: Readonly<{ value: number | string; currency: string }>) {
  const negative = Number(value) < 0;
  return (
    <Amount
      value={value}
      currency={currency}
      kind={negative ? "expense" : "neutral"}
      className={negative ? "text-destructive" : undefined}
    />
  );
}

export default async function BankAccountsPage() {
  const t = await getTranslations("bankAccounts");
  const tw = await getTranslations("wise");
  const { orgId, role } = await requireOrgWithRole();
  const [rows, wise] = await Promise.all([
    listAccountBalances(orgId, { includeInactive: true }),
    getIntegration(orgId, "wise"),
  ]);
  // 對應到 Wise 餘額的帳本帳戶（名稱旁標 Wise）；整合可用且有對應時，owner / admin 看得到同步按鈕。
  const wiseMapped = new Set(
    parseWiseConfig(wise?.config)
      .accountMappings.map((m) => m.bankAccountId)
      .filter((id): id is number => id !== null),
  );
  // 整合斷線（error / needs_reauth）時，對應帳戶上的 Wise 標籤改成紅點脈衝，提示同步失敗。
  const wiseFailed = Boolean(wise?.enabled && wise.status !== "connected");
  const canSyncWise =
    canManageOrg(role) &&
    Boolean(wise?.enabled && wise.status === "connected") &&
    wiseMapped.size > 0;

  return (
    <>
      <PageHeader title={t("title")}>
        {canSyncWise ? <WiseSyncButton /> : null}
        {canManageOrg(role) ? <SinopacImportButton /> : null}
        <NewBankAccountDialog />
      </PageHeader>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead>{t("columns.currency")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="text-right">{t("columns.openingBalance")}</TableHead>
              <TableHead className="text-right">{t("columns.currentBalance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message={t("empty")} />
            ) : (
              rows.map((a) => (
                <RowDialog
                  key={a.id}
                  title={a.name}
                  description={t("rowDialogDescription")}
                  cells={
                    <>
                      <TableCell className="font-medium">
                        <span className="flex items-center gap-2">
                          {a.name}
                          {wiseMapped.has(a.id) ? (
                            <span title={wiseFailed ? (wise?.lastError ?? undefined) : undefined}>
                              <StatusTag
                                tone={wiseFailed ? "risk" : "primary"}
                                pulse={wiseFailed}
                              >
                                {wiseFailed ? tw("sync.mappedFailed") : tw("sync.mappedBadge")}
                              </StatusTag>
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {a.kind === "bank" ? t("physical") : t("virtual")}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <CurrencyFlag currency={a.currency} />
                          {a.currency}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={a.isActive ? "income" : "neutral"}>
                          {a.isActive ? t("active") : t("inactive")}
                        </StatusTag>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        <Balance value={a.openingBalance} currency={a.currency} />
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <Balance value={a.bookBalance} currency={a.currency} />
                      </TableCell>
                    </>
                  }
                >
                  <EditBankAccountForm
                    account={{
                      id: a.id,
                      name: a.name,
                      kind: a.kind,
                      currency: a.currency,
                      openingBalance: a.openingBalance,
                      isActive: a.isActive,
                    }}
                    footer={<DeleteButton action={deleteBankAccount} id={a.id} />}
                  />
                </RowDialog>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}
