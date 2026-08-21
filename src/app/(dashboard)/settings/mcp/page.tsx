import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { CopyButton } from "@/components/copy-button";
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
import { listMcpClients, getMemberRole, listMyOrgs } from "@/db/queries";
import { formatDate } from "@/lib/format";
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
  const { orgId, userId } = await requireOrg();
  const [clients, role, myOrgs, h] = await Promise.all([
    listMcpClients(),
    getMemberRole(orgId, userId),
    listMyOrgs(userId),
    headers(),
  ]);
  const canManage = role === "owner" || role === "admin";

  const host = h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const mcpUrl = `${origin}/mcp`;
  const discoveryUrl = `${origin}/.well-known/oauth-authorization-server`;

  const colSpan = canManage ? 7 : 6;

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
            <div className="space-y-1.5">
              <div className="text-sm font-medium">{t("mcp.connectionInfo.serverUrlLabel")}</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-sm">
                  {mcpUrl}
                </code>
                <CopyButton value={mcpUrl} />
              </div>
            </div>
            {myOrgs.length > 1 && (
              <div className="space-y-1.5">
                <div className="text-sm font-medium">{t("mcp.connectionInfo.perOrgLabel")}</div>
                <p className="text-xs text-muted-foreground">
                  {t("mcp.connectionInfo.perOrgHint")}
                </p>
                <ul className="space-y-2">
                  {myOrgs.map((o) => {
                    const url = `${mcpUrl}?org=${o.slug ?? o.id}`;
                    return (
                      <li key={o.id} className="flex items-center gap-2">
                        <span className="w-32 shrink-0 truncate text-sm">{o.name}</span>
                        <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                          {url}
                        </code>
                        <CopyButton value={url} label="" />
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
            {canManage
              ? t("mcp.clients.hintManage")
              : t("mcp.clients.hintNoManage")}
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
                  {canManage && <TableHead className="text-right">{t("mcp.clients.columns.actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length === 0 ? (
                  <EmptyRow colSpan={colSpan} message={t("mcp.clients.empty")}>
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
                      {canManage && (
                        <TableCell className="text-right">
                          <RevokeClientButton
                            clientId={c.clientId}
                            name={c.name || t("mcp.clients.unnamedClient")}
                          />
                        </TableCell>
                      )}
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
