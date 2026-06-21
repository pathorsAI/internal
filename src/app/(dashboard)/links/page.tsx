import { DeleteButton } from "@/components/delete-button";
import { deleteLink } from "@/db/mutations";
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
import { listLinks, listParties, listProjects } from "@/db/queries";
import { formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { NewLinkDialog } from "./new-link-dialog";

export const dynamic = "force-dynamic";

export default async function LinksPage() {
  const { orgId } = await requireOrg();
  const [rows, parties, projects] = await Promise.all([
    listLinks(orgId),
    listParties(orgId),
    listProjects(orgId),
  ]);

  return (
    <>
      <PageHeader
        title="連結"
        description="把 Google Drive 合約等外部連結貼在這裡，可選擇掛到客戶 / 專案"
      >
        <NewLinkDialog
          parties={parties.map((p) => ({ id: p.id, name: p.name }))}
          projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        />
      </PageHeader>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>標題</TableHead>
              <TableHead>關聯</TableHead>
              <TableHead>備註</TableHead>
              <TableHead>建立</TableHead>
              <TableHead className="text-right">動作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  尚無連結，點右上角新增
                </TableCell>
              </TableRow>
            ) : (
              rows.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    <a
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                      {l.title}
                    </a>
                  </TableCell>
                  <TableCell className="space-x-1">
                    {l.partyName ? (
                      <Badge variant="outline">客戶：{l.partyName}</Badge>
                    ) : null}
                    {l.projectName ? (
                      <Badge variant="outline">專案：{l.projectName}</Badge>
                    ) : null}
                    {l.contractTitle ? (
                      <Badge variant="outline">合約：{l.contractTitle}</Badge>
                    ) : null}
                    {!l.partyName && !l.projectName && !l.contractTitle ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate text-xs text-muted-foreground">
                    {l.note ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(l.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton action={deleteLink} id={l.id} />
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
