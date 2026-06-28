import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteEmployee } from "@/db/mutations";
import { EditEmployeeForm } from "./edit-employee-form";
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
import { listEmployees, listPayrollItemTypes, listBankAccounts } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { NewEmployeeDialog } from "./new-employee-dialog";
import { PaySalaryDialog } from "./pay-salary-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const empType: Record<string, string> = {
  full_time: "正職",
  part_time: "兼職",
  freelancer: "自由",
  contractor: "承攬",
};

export default async function EmployeesPage() {
  const { orgId } = await requireOrg();
  const [rows, itemTypes, accounts] = await Promise.all([
    listEmployees(orgId),
    listPayrollItemTypes(orgId),
    listBankAccounts(orgId),
  ]);
  const accountList = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));

  return (
    <>
      <PageHeader title="員工" description="員工名冊與勞健保 / 勞退投保狀態">
        <NewEmployeeDialog />
      </PageHeader>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>到職日</TableHead>
              <TableHead>勞健保投保</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">底薪</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  尚無員工
                </TableCell>
              </TableRow>
            ) : (
              rows.map((e) => (
                <RowDialog
                  key={e.id}
                  title={e.name}
                  description="員工"
                  cells={
                    <>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {empType[e.employmentType] ?? e.employmentType}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.startDate ? formatDate(e.startDate) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 text-xs">
                          {e.laborInsuredSalary ? (
                            <Badge variant="outline" className="font-normal">
                              勞保 {formatCurrency(e.laborInsuredSalary)}
                            </Badge>
                          ) : null}
                          {e.healthInsuredSalary ? (
                            <Badge variant="outline" className="font-normal">
                              健保 {formatCurrency(e.healthInsuredSalary)}
                            </Badge>
                          ) : null}
                          {e.hasPension ? (
                            <Badge variant="outline" className="font-normal">
                              勞退
                            </Badge>
                          ) : null}
                          {!e.laborInsuredSalary && !e.healthInsuredSalary && !e.hasPension ? (
                            <span className="text-muted-foreground">—</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={e.isActive ? "outline" : "secondary"}>
                          {e.isActive ? "在職" : "離職"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {e.baseSalary ? formatCurrency(e.baseSalary) : "—"}
                      </TableCell>
                    </>
                  }
                >
                  <EditEmployeeForm
                    employee={{
                      id: e.id,
                      name: e.name,
                      nationalId: e.nationalId,
                      employmentType: e.employmentType,
                      hasPension: e.hasPension,
                      baseSalary: e.baseSalary,
                      laborInsuredSalary: e.laborInsuredSalary,
                      healthInsuredSalary: e.healthInsuredSalary,
                      salaryAccount: e.salaryAccount,
                      startDate: e.startDate,
                      endDate: e.endDate,
                      isActive: e.isActive,
                    }}
                    footer={
                      <div className="flex items-center gap-1">
                        {e.isActive ? (
                          <PaySalaryDialog
                            employee={{ id: e.id, name: e.name, baseSalary: e.baseSalary }}
                            itemTypes={itemTypes}
                            accounts={accountList}
                          />
                        ) : null}
                        <DeleteButton action={deleteEmployee} id={e.id} />
                      </div>
                    }
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
