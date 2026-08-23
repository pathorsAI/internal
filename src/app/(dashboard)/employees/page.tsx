import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteEmployee } from "@/db/mutations";
import { EditEmployeeForm } from "./edit-employee-form";
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
import { listEmployees, listPayrollItemTypes, listBankAccounts, listOrgMembers } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { NewEmployeeDialog } from "./new-employee-dialog";
import { PaySalaryDialog } from "./pay-salary-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

type EmployeeRow = Awaited<ReturnType<typeof listEmployees>>[number];
type InsuranceLabels = { labor: string; health: string; pension: string };

/** 聯絡資訊：公司信箱 / 個人信箱 / 電話，三個都空就顯示破折號。 */
function contactCell(e: EmployeeRow) {
  if (!e.workEmail && !e.personalEmail && !e.phone) return "—";
  return (
    <div className="flex flex-col text-xs">
      {e.workEmail ? <span>{e.workEmail}</span> : null}
      {e.personalEmail ? <span>{e.personalEmail}</span> : null}
      {e.phone ? <span>{e.phone}</span> : null}
    </div>
  );
}

/** 投保狀態：勞保 / 健保 / 勞退各一顆徽章，都沒有就顯示破折號。 */
function insuranceCell(e: EmployeeRow, labels: InsuranceLabels) {
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      {e.laborInsuredSalary ? (
        <Badge variant="outline" className="font-normal">
          {labels.labor} {formatCurrency(e.laborInsuredSalary)}
        </Badge>
      ) : null}
      {e.healthInsuredSalary ? (
        <Badge variant="outline" className="font-normal">
          {labels.health} {formatCurrency(e.healthInsuredSalary)}
        </Badge>
      ) : null}
      {e.hasPension ? (
        <Badge variant="outline" className="font-normal">
          {labels.pension}
        </Badge>
      ) : null}
      {!e.laborInsuredSalary && !e.healthInsuredSalary && !e.hasPension ? (
        <span className="text-muted-foreground">—</span>
      ) : null}
    </div>
  );
}

export default async function EmployeesPage() {
  const t = await getTranslations("employees");
  const empType: Record<string, string> = {
    full_time: t("type.full_time"),
    part_time: t("type.part_time"),
    freelancer: t("type.freelancer"),
    contractor: t("type.contractor"),
  };
  const { orgId } = await requireOrg();
  const [rows, itemTypes, accounts, members] = await Promise.all([
    listEmployees(orgId),
    listPayrollItemTypes(orgId),
    listBankAccounts(orgId),
    listOrgMembers(orgId),
  ]);
  const accountList = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const memberByUserId = new Map(members.map((m) => [m.userId, m]));
  const insuranceLabels: InsuranceLabels = {
    labor: t("insurance.labor"),
    health: t("insurance.health"),
    pension: t("insurance.pension"),
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        <NewEmployeeDialog members={members} />
      </PageHeader>
      <TableCard title={t("table.title")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.columns.name")}</TableHead>
              <TableHead>{t("table.columns.type")}</TableHead>
              <TableHead>{t("table.columns.contact")}</TableHead>
              <TableHead>{t("table.columns.startDate")}</TableHead>
              <TableHead>{t("table.columns.insurance")}</TableHead>
              <TableHead>{t("table.columns.status")}</TableHead>
              <TableHead className="text-right">{t("table.columns.baseSalary")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7} message={t("table.empty")} />
            ) : (
              rows.map((e) => (
                <RowDialog
                  key={e.id}
                  title={e.name}
                  description={t("dialog.recordLabel")}
                  cells={
                    <>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          {e.name}
                          {e.userId ? (
                            <Badge variant="secondary" className="font-normal text-xs">
                              {memberByUserId.get(e.userId)?.name ?? t("table.linked")}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {empType[e.employmentType] ?? e.employmentType}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{contactCell(e)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.startDate ? formatDate(e.startDate) : "—"}
                      </TableCell>
                      <TableCell>{insuranceCell(e, insuranceLabels)}</TableCell>
                      <TableCell>
                        <Badge variant={e.isActive ? "outline" : "secondary"}>
                          {e.isActive ? t("status.active") : t("status.inactive")}
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
                      workEmail: e.workEmail,
                      personalEmail: e.personalEmail,
                      phone: e.phone,
                      note: e.note,
                      userId: e.userId,
                      isActive: e.isActive,
                    }}
                    members={members}
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
      </TableCard>
    </>
  );
}
