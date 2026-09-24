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
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import {
  groupAccountsByEmployee,
  listEmployeeAccounts,
  readMaskedNationalId,
  readNationalId,
} from "@/db/employee-accounts";
import { maskBankAccount } from "@/lib/pii";

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

async function nationalIdView(
  e: EmployeeRow,
  canManage: boolean,
): Promise<{ value: string | null; masked: boolean }> {
  if (canManage) {
    try {
      return { value: await readNationalId(e), masked: false };
    } catch {
      // fall through to the masked view
    }
  }
  return { value: await readMaskedNationalId(e), masked: true };
}

export default async function EmployeesPage() {
  const t = await getTranslations("employees");
  const empType: Record<string, string> = {
    full_time: t("type.full_time"),
    part_time: t("type.part_time"),
    freelancer: t("type.freelancer"),
    contractor: t("type.contractor"),
  };
  const { orgId, role } = await requireOrgWithRole();
  const canManage = canManageOrg(role);
  const [rows, itemTypes, accounts, members, employeeAccounts] = await Promise.all([
    listEmployees(orgId),
    listPayrollItemTypes(orgId),
    listBankAccounts(orgId),
    listOrgMembers(orgId),
    listEmployeeAccounts(orgId),
  ]);
  const accountsByEmployee = groupAccountsByEmployee(employeeAccounts);
  // 身分證字號：owner / admin 拿到解密後的完整值（可編輯）；成員只拿到遮罩值。
  // 明文只在 server 端出現，成員的 RSC payload 裡不會有完整值。解不開（金鑰缺失）
  // 時連 owner / admin 也退回遮罩且不可編輯，免得把遮罩值存回去蓋掉原值。
  const nationalIds = new Map(
    await Promise.all(rows.map(async (e) => [e.id, await nationalIdView(e, canManage)] as const)),
  );
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
        {canManage ? <NewEmployeeDialog members={members} /> : null}
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
                  variant="sheet"
                  rowId={e.id}
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
                      nationalId: nationalIds.get(e.id)?.value ?? null,
                      nationalIdMasked: nationalIds.get(e.id)?.masked ?? true,
                      employmentType: e.employmentType,
                      hasPension: e.hasPension,
                      baseSalary: e.baseSalary,
                      laborInsuredSalary: e.laborInsuredSalary,
                      healthInsuredSalary: e.healthInsuredSalary,
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
                    accounts={accountsByEmployee.get(e.id) ?? []}
                    legacySalaryAccount={maskBankAccount(e.salaryAccount)}
                    canManage={canManage}
                    footer={
                      <div className="flex items-center gap-1">
                        {e.isActive ? (
                          <PaySalaryDialog
                            employee={{ id: e.id, name: e.name, baseSalary: e.baseSalary }}
                            itemTypes={itemTypes}
                            accounts={accountList}
                            employeeAccounts={(accountsByEmployee.get(e.id) ?? []).filter((a) => a.isActive)}
                          />
                        ) : null}
                        {canManage ? <DeleteButton action={deleteEmployee} id={e.id} /> : null}
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
