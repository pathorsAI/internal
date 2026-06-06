import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteReceivable } from "@/db/mutations";
import { EditReceivableForm } from "./edit-receivable-form";
import { CollectButton } from "./collect-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listReceivables,
  listParties,
  listProjects,
  listContracts,
  listSubscriptions,
  listBankAccounts,
} from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { NewReceivableDialog } from "./new-receivable-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusMap: Record<string, string> = { open: "未收", paid: "已收", void: "作廢" };
const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  open: "default",
  paid: "secondary",
  void: "outline",
};

export default async function ReceivablesPage() {
  const { orgId } = await requireOrg();
  const [rows, parties, projects, contracts, subscriptions, accounts] = await Promise.all([
    listReceivables(orgId),
    listParties(orgId),
    listProjects(orgId),
    listContracts(orgId),
    listSubscriptions(orgId),
    listBankAccounts(orgId),
  ]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const contractOptions = contracts.map((c) => ({
    id: c.id,
    name: c.customerName ? `${c.title}（${c.customerName}）` : c.title,
  }));
  const subscriptionOptions = subscriptions.map((s) => ({
    id: s.id,
    name: s.customerName ? `${s.name}（${s.customerName}）` : s.name,
  }));
  const accountOptions = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));

  return (
    <>
      <PageHeader title="應收帳款" description="待客戶支付的款項；收款後自動建立一筆收入交易">
        <NewReceivableDialog
          parties={partyOptions}
          projects={projectOptions}
          contracts={contractOptions}
          subscriptions={subscriptionOptions}
        />
      </PageHeader>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>客戶</TableHead>
              <TableHead>說明</TableHead>
              <TableHead>專案</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead>到期日</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">動作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  尚無應收帳款，點右上角新增
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <RowDialog
                  key={r.id}
                  title={r.customerName ?? "應收帳款"}
                  description={r.description ?? "應收帳款"}
                  cells={
                    <>
                      <TableCell className="font-medium">{r.customerName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.description ?? r.contractTitle ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.projectName ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(r.amount, r.currency)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.dueDate ? formatDate(r.dueDate) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[r.status] ?? "outline"}>
                          {statusMap[r.status] ?? r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {r.status === "open" ? (
                            <CollectButton id={r.id} accounts={accountOptions} />
                          ) : null}
                          <DeleteButton action={deleteReceivable} id={r.id} />
                        </div>
                      </TableCell>
                    </>
                  }
                >
                  <EditReceivableForm
                    receivable={{
                      id: r.id,
                      customerPartyId: r.customerPartyId,
                      projectId: r.projectId,
                      contractId: r.contractId,
                      subscriptionId: r.subscriptionId,
                      description: r.description,
                      amount: r.amount,
                      currency: r.currency,
                      dueDate: r.dueDate,
                    }}
                    parties={partyOptions}
                    projects={projectOptions}
                    contracts={contractOptions}
                    subscriptions={subscriptionOptions}
                    readOnly={r.status === "paid"}
                  />
                </RowDialog>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
