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
import { listParties, listBankAccounts } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { NewPartyDialog } from "./new-party-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const labelMap: Record<string, string> = {
  vendor: "廠商",
  customer: "客戶",
  gov: "政府機關",
  other: "其他",
};

export default async function PartiesPage() {
  const { orgId } = await requireOrg();
  const [rows, accounts] = await Promise.all([listParties(orgId), listBankAccounts(orgId)]);

  return (
    <>
      <PageHeader title="交易對象" description="往來的廠商、客戶、機關，點名稱可看詳細與編輯">
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
              <TableHead className="text-right">累計 (TWD)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={5} message="尚無交易對象">點右上角新增</EmptyRow>
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
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(s.txnTotal)}
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
