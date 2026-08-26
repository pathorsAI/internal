import { Paperclip, BellRing, CheckCircle2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
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
import { listAccountantNotices } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { NotifyButton } from "./notify-button";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

type Notice = Awaited<ReturnType<typeof listAccountantNotices>>[number];
type NoticesT = Awaited<ReturnType<typeof getTranslations<"accountantNotices">>>;

function NoticeTable({
  rows,
  done,
  t,
}: Readonly<{ rows: Notice[]; done: boolean; t: NoticesT }>) {
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">{t("columns.date")}</TableHead>
          <TableHead>{t("columns.party")}</TableHead>
          <TableHead>{t("columns.summary")}</TableHead>
          <TableHead className="w-32 text-right">{t("columns.amount")}</TableHead>
          <TableHead>{t("columns.document")}</TableHead>
          <TableHead className="w-28">{t("columns.notifiedAt")}</TableHead>
          <TableHead className="text-right">{t("columns.action")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7} message={done ? t("emptyDone") : t("emptyPending")} />
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
                  <span className="text-xs text-muted-foreground">{t("noAttachment")}</span>
                ) : (
                  <a
                    href={`/api/documents/${r.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <Paperclip className="size-3.5" />
                    {r.fileName ?? t("view")}
                  </a>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {r.notifiedAt ? formatDate(r.notifiedAt) : "—"}
              </TableCell>
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
  const t = await getTranslations("accountantNotices");
  const { orgId } = await requireOrg();
  const all = await listAccountantNotices(orgId);
  const pending = all.filter((r) => !r.notifiedAt);
  const done = all.filter((r) => r.notifiedAt);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <TableCard
        title={
          <span className="flex items-center gap-2">
            <BellRing className="size-4 text-amber-600" />
            {t("pending.title")}
            {pending.length > 0 ? (
              <Badge variant="destructive">{pending.length}</Badge>
            ) : null}
          </span>
        }
        action={t("pending.action")}
      >
        <NoticeTable rows={pending} done={false} t={t} />
      </TableCard>

      <TableCard
        title={
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-4 text-muted-foreground" />
            {t("done.title")}
          </span>
        }
      >
        <NoticeTable rows={done} done={true} t={t} />
      </TableCard>
    </>
  );
}
