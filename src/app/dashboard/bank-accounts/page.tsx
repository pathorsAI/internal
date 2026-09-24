import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteBankAccount } from "@/db/mutations";
import { EditBankAccountForm } from "./edit-bank-account-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { formatCurrency } from "@/lib/format";
import { CurrencyFlag } from "@/components/currency-flag";
import { NewBankAccountDialog } from "./new-bank-account-dialog";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { getIntegration } from "@/lib/integrations/store";
import { parseWiseConfig } from "@/lib/wise-sync";
import { WiseSyncButton } from "./wise-sync-sheet";

export const dynamic = "force-dynamic";

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
  const canSyncWise =
    canManageOrg(role) &&
    Boolean(wise?.enabled && wise.status === "connected") &&
    wiseMapped.size > 0;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        {canSyncWise ? <WiseSyncButton /> : null}
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
                            <Badge variant="outline" className="font-normal">
                              {tw("sync.mappedBadge")}
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.kind === "bank" ? "outline" : "secondary"}>
                          {a.kind === "bank" ? t("physical") : t("virtual")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <CurrencyFlag currency={a.currency} />
                          {a.currency}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.isActive ? "outline" : "secondary"}>
                          {a.isActive ? t("active") : t("inactive")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatCurrency(a.openingBalance, a.currency)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(a.bookBalance, a.currency)}
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
