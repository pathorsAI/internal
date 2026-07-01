import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteParty } from "@/db/mutations";
import { EditPartyForm } from "./edit-party-form";
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
import { listParties, listBankAccounts, type PartyTotal } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { CurrencyFlag } from "@/components/currency-flag";
import { cn } from "@/lib/utils";
import { NewPartyDialog } from "./new-party-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const labelMap: Record<string, string> = {
  vendor: "廠商",
  customer: "客戶",
  gov: "政府機關",
  other: "其他",
};

/** 依幣別逐行顯示某方向（收款/付款）的累計；不同幣別分開，不換算。 */
function MoneyLines({
  totals,
  field,
  tone,
}: Readonly<{ totals: PartyTotal[]; field: "received" | "paid"; tone: string }>) {
  const lines = totals.filter((t) => t[field] !== 0);
  if (lines.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5">
      {lines.map((t) => (
        <span key={t.currency} className={cn("flex items-center justify-end gap-1.5 tabular-nums", tone)}>
          <CurrencyFlag currency={t.currency} className="h-3" />
          {formatCurrency(t[field], t.currency)}
        </span>
      ))}
    </div>
  );
}

export default async function PartiesPage() {
  const { orgId } = await requireOrg();
  const [rows, accounts] = await Promise.all([listParties(orgId), listBankAccounts(orgId)]);

  return (
    <>
      <PageHeader
        title="交易對象"
        description="往來的廠商、客戶、機關；收款＝對方付我們、付款＝我們付對方，依幣別分開加總"
      >
        <NewPartyDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        />
      </PageHeader>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>統編</TableHead>
              <TableHead className="text-right">交易數</TableHead>
              <TableHead className="text-right">收款</TableHead>
              <TableHead className="text-right">付款</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message="尚無交易對象">點右上角新增</EmptyRow>
            ) : (
              rows.map((s) => (
                <RowDialog
                  key={s.id}
                  title={s.name}
                  description="交易對象"
                  cells={
                    <>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{labelMap[s.label] ?? s.label}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.taxId ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.txnCount}</TableCell>
                      <TableCell className="text-right font-medium">
                        <MoneyLines totals={s.totals} field="received" tone="text-income" />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <MoneyLines totals={s.totals} field="paid" tone="text-expense" />
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
                      isActive: s.isActive,
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
