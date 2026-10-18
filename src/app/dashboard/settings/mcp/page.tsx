import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { CopyButton } from "@/components/copy-button";
import { AddToClaudeButton } from "@/components/add-to-claude-button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { listMcpClients, listMyOrgs } from "@/db/queries";
import { formatDate } from "@/lib/format";
import { internalConnectorName, orgMcpUrl } from "@/lib/claude-connector";
import { requestOrigin } from "@/lib/request-origin";
import { requireOrg } from "@/lib/session";
import { RevokeClientButton } from "./revoke-client-button";

export const dynamic = "force-dynamic";

export default async function McpPage() {
  const t = await getTranslations("settings");
  const typeLabel: Record<string, string> = {
    web: t("mcp.clients.type.web"),
    native: t("mcp.clients.type.native"),
    "user-agent-based": t("mcp.clients.type.user-agent-based"),
    public: t("mcp.clients.type.public"),
  };
  const { userId } = await requireOrg();
  // MCP 授權是個人的、不是組織的：這頁只列出這位使用者自己授權過的用戶端，
  // 撤銷也只撤銷自己的，所以不需要（也不該）判斷組織角色。
  const [clients, myOrgs, h] = await Promise.all([
    listMcpClients(userId),
    listMyOrgs(userId),
    headers(),
  ]);

  const origin = requestOrigin(h);
  const mcpUrl = `${origin}/mcp`;
  // 只有一個組織時，頂端直接給一顆「在 Claude 中連接」；多個組織就靠下面每列各自的按鈕。
  const onlyOrg = myOrgs.length === 1 ? myOrgs[0] : null;
  const discoveryUrl = `${origin}/.well-known/oauth-authorization-server`;

  return (
    <>
      <PageHeader
        title={t("mcp.title")}
        description={t("mcp.description")}
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("mcp.connectionInfo.title")}</CardTitle>
            <CardDescription>
              {t("mcp.connectionInfo.description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {onlyOrg && (
              <div className="space-y-1.5">
                <AddToClaudeButton
                  size="default"
                  name={internalConnectorName(onlyOrg.name)}
                  url={orgMcpUrl(mcpUrl, onlyOrg)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("mcp.connectionInfo.addToClaudeHint")}
                </p>
              </div>
            )}
            <div className="space-y-1.5">
              <div className="text-sm font-medium">{t("mcp.connectionInfo.serverUrlLabel")}</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-sm">
                  {mcpUrl}
                </code>
                <CopyButton value={mcpUrl} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("mcp.connectionInfo.serverUrlHint")}
              </p>
            </div>
            {myOrgs.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium">{t("mcp.connectionInfo.perOrgLabel")}</div>
                <p className="text-xs text-muted-foreground">
                  {t("mcp.connectionInfo.perOrgHint")}
                </p>
                <ul className="space-y-2">
                  {myOrgs.map((o) => {
                    const url = orgMcpUrl(mcpUrl, o);
                    return (
                      <li key={o.id} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                        <span className="w-32 shrink-0 truncate text-sm">{o.name}</span>
                        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                          {url}
                        </code>
                        <CopyButton value={url} label="" />
                        <AddToClaudeButton
                          name={internalConnectorName(o.name)}
                          url={url}
                          className="shrink-0"
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t("mcp.connectionInfo.discoveryLabel")}<code className="text-xs">{discoveryUrl}</code>
            </p>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {t("mcp.clients.hint")}
            {t("mcp.clients.hintManage")}
          </p>
          <TableCard title={t("mcp.clients.title")} action={t("mcp.clients.count", { count: clients.length })}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("mcp.clients.columns.name")}</TableHead>
                  <TableHead>{t("mcp.clients.columns.clientId")}</TableHead>
                  <TableHead>{t("mcp.clients.columns.type")}</TableHead>
                  <TableHead className="text-right">{t("mcp.clients.columns.activeTokens")}</TableHead>
                  <TableHead>{t("mcp.clients.columns.status")}</TableHead>
                  <TableHead>{t("mcp.clients.columns.createdAt")}</TableHead>
                  <TableHead className="text-right">{t("mcp.clients.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length === 0 ? (
                  <EmptyRow colSpan={7} message={t("mcp.clients.empty")}>
                    {t("mcp.clients.emptyHint")}
                  </EmptyRow>
                ) : (
                  clients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.name || t("mcp.clients.unnamed")}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5">
                          <code className="text-xs text-muted-foreground">
                            {c.clientId.slice(0, 12)}…
                          </code>
                          <CopyButton value={c.clientId} label="" />
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {typeLabel[c.type] ?? c.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.activeTokens}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.disabled ? "secondary" : "default"}>
                          {c.disabled ? t("mcp.clients.status.disabled") : t("mcp.clients.status.enabled")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(c.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <RevokeClientButton
                          clientId={c.clientId}
                          name={c.name || t("mcp.clients.unnamedClient")}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableCard>
        </div>
      </div>
    </>
  );
}
