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
import { listEmployees } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const empType: Record<string, string> = {
  full_time: "正職",
  part_time: "兼職",
  freelancer: "自由",
  contractor: "承攬",
};

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <Badge variant={on ? "outline" : "secondary"} className={on ? "" : "opacity-50"}>
      {label}
    </Badge>
  );
}

export default async function EmployeesPage() {
  const rows = await listEmployees();

  return (
    <>
      <PageHeader title="員工" description="員工名冊與勞健保 / 勞退投保狀態" />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>到職日</TableHead>
              <TableHead>投保</TableHead>
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
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {empType[e.employmentType] ?? e.employmentType}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.startDate ? formatDate(e.startDate) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Flag on={e.hasLaborInsurance} label="勞保" />
                      <Flag on={e.hasHealthInsurance} label="健保" />
                      <Flag on={e.hasPension} label="勞退" />
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
