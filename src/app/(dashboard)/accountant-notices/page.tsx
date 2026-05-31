import { Paperclip, BellRing, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listAccountantNotices } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { NotifyButton } from "./notify-button";

export const dynamic = "force-dynamic";

type Notice = Awaited<ReturnType<typeof listAccountantNotices>>[number];

function NoticeTable({ rows, done }: Readonly<{ rows: Notice[]; done: boolean }>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>日期</TableHead>
          <TableHead>對象</TableHead>
          <TableHead>摘要</TableHead>
          <TableHead className="text-right">金額</TableHead>
          <TableHead>憑證</TableHead>
          {done ? <TableHead>通知時間</TableHead> : null}
          <TableHead className="text-right">動作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={done ? 7 : 6} className="text-center text-muted-foreground">
              {done ? "尚無已通知紀錄" : "沒有待通知的其他發票 🎉"}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDate(r.txnDate)}
              </TableCell>
              <TableCell>{r.partyName ?? "—"}</TableCell>
              <TableCell className="max-w-[24ch] truncate text-muted-foreground">
                {r.description ?? r.categoryName ?? "—"}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatCurrency(r.amount, r.currency)}
              </TableCell>
              <TableCell>
                {r.r2Key.startsWith("meta/") ? (
                  <span className="text-xs text-muted-foreground">（無附檔）</span>
                ) : (
                  <a
                    href={`/api/documents/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Paperclip className="size-3.5" />
                    {r.fileName ?? "檢視"}
                  </a>
                )}
              </TableCell>
              {done ? (
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {r.notifiedAt ? formatDate(r.notifiedAt) : "—"}
                </TableCell>
              ) : null}
              <TableCell className="text-right">
                <NotifyButton id={r.id} notified={done} />
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export default async function AccountantNoticesPage() {
  const all = await listAccountantNotices();
  const pending = all.filter((r) => !r.notifiedAt);
  const done = all.filter((r) => r.notifiedAt);

  return (
    <>
      <PageHeader
        title="待通知會計師"
        description="電子發票會計師會自動看到;這裡是其他發票（三聯式等），要主動告訴會計師的清單"
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="size-4 text-amber-600" />
            待通知
            {pending.length > 0 ? (
              <Badge variant="destructive">{pending.length}</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>告訴會計師後，按「標記已通知」</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <NoticeTable rows={pending} done={false} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-4 text-muted-foreground" />
            已通知
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <NoticeTable rows={done} done={true} />
        </CardContent>
      </Card>
    </>
  );
}
