import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { WireframeNotice } from "@/components/wireframe-notice";
import { Button } from "@/components/ui/button";
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
import { formatDate } from "@/lib/format";
import { sampleAccounts } from "@/lib/wireframe-data";

const statusVariant = {
  active: "default",
  invited: "secondary",
  suspended: "destructive",
} as const;

export default function AccountsPage() {
  return (
    <>
      <PageHeader title="帳戶管理" description="管理內部人員與外部帳戶">
        <Button size="sm">
          <Plus className="size-4" /> 新增帳戶
        </Button>
      </PageHeader>
      <WireframeNotice />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">建立日期</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sampleAccounts.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {a.email}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{a.role}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant[a.status]}>{a.status}</Badge>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {formatDate(a.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
