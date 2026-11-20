import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteParty } from "@/db/mutations";
import { EditPartyForm } from "./edit-party-form";
import { PageHeader } from "@/components/page-header";
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
import { listParties, listBankAccounts, type PartyTotal } from "@/db/queries";
import { Amount } from "@/components/amount";
import { CurrencyFlag } from "@/components/currency-flag";
import { NewPartyDialog } from "./new-party-dialog";
import { requireOrg } from "@/lib/session";
import { PartyAvatar } from "@/components/party-avatar";

export const dynamic = "force-dynamic";

/** 依幣別逐行顯示某方向（收款/付款）的累計；不同幣別分開，不換算。收款綠色帶 +、付款墨色帶 −。 */
function MoneyLines({
  totals,
  field,
}: Readonly<{ totals: PartyTotal[]; field: "received" | "paid" }>) {
  const lines = totals.filter((t) => t[field] !== 0);
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {lines.map((t) => (
        <span key={t.currency} className="flex items-center justify-end gap-1.5">
          <CurrencyFlag currency={t.currency} className="h-3" />
          <Amount
            value={t[field]}
            currency={t.currency}
            kind={field === "received" ? "income" : "expense"}
          />
        </span>
      ))}
    </div>
  );
}

export default async function PartiesPage() {
  const t = await getTranslations("parties");
  const { orgId } = await requireOrg();
  const [rows, accounts] = await Promise.all([listParties(orgId), listBankAccounts(orgId)]);

  const labelMap: Record<string, string> = {
    vendor: t("label.vendor"),
    customer: t("label.customer"),
    gov: t("label.gov"),
    other: t("label.other"),
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        <NewPartyDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        />
      </PageHeader>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.name")}</TableHead>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead>{t("columns.taxId")}</TableHead>
              <TableHead className="text-right">{t("columns.txnCount")}</TableHead>
              <TableHead className="text-right">{t("columns.received")}</TableHead>
              <TableHead className="text-right">{t("columns.paid")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message={t("empty")}>{t("emptyHint")}</EmptyRow>
            ) : (
              rows.map((s) => (
                <RowDialog
                  key={s.id}
                  rowId={s.id}
                  title={s.name}
                  description={t("rowDialogDescription")}
                  cells={
                    <>
                      <TableCell className="font-medium">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <PartyAvatar name={s.name} partyId={s.id} avatarVersion={s.avatarVersion} />
                          <span className="truncate">{s.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {labelMap[s.label] ?? s.label}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">{s.taxId ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.txnCount}</TableCell>
                      <TableCell className="text-right font-medium">
                        <MoneyLines totals={s.totals} field="received" />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <MoneyLines totals={s.totals} field="paid" />
                      </TableCell>
                    </>
                  }
                >
                  <EditPartyForm
                    party={{
                      id: s.id,
                      name: s.name,
                      label: s.label,
                      taxId: s.taxId,
                      defaultCurrency: s.defaultCurrency,
                      defaultAccountId: s.defaultAccountId,
                      typicalAmount: s.typicalAmount,
                      contact: s.contact,
                      note: s.note,
                      aliases: s.aliases,
                      isActive: s.isActive,
                      avatarVersion: s.avatarVersion,
                    }}
                    accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
                    footer={<DeleteButton action={deleteParty} id={s.id} />}
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
