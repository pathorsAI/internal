import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { CopyButton } from "@/components/copy-button";
import { StatusTag } from "@/components/ds/status-dot";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listApiKeys } from "@/lib/api-keys";
import { formatDate, formatDateTime } from "@/lib/format";
import { requestOrigin } from "@/lib/request-origin";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { SettingsBody } from "../settings-body";
import { CreateApiKeyButton, RevokeApiKeyButton } from "./api-keys-client";

export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "income", expired: "warning", revoked: "neutral" } as const;

export default async function ApiSettingsPage() {
  const t = await getTranslations("settings");
  const { orgId, role } = await requireOrgWithRole();
  const canManage = canManageOrg(role);
  const [keys, h] = await Promise.all([canManage ? listApiKeys(orgId) : Promise.resolve([]), headers()]);
  const origin = requestOrigin(h);
  const baseUrl = `${origin}/api/v1`;
  const openApiUrl = `${origin}/api/v1/openapi.json`;

  return (
    <>
      <PageHeader title={t("api.title")}>
        {canManage ? <CreateApiKeyButton /> : null}
      </PageHeader>

      <SettingsBody>
        <Card>
          <CardHeader>
            <CardTitle>{t("api.usage.title")}</CardTitle>
            <CardDescription>{t("api.usage.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">{t("api.usage.baseUrl")}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-1.5 font-mono text-xs">{baseUrl}</code>
                <CopyButton value={baseUrl} label="" />
              </dd>
              <dt className="text-muted-foreground">{t("api.usage.openApi")}</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-1.5 font-mono text-xs">{openApiUrl}</code>
                <CopyButton value={openApiUrl} label="" />
              </dd>
              <dt className="text-muted-foreground">{t("api.usage.auth")}</dt>
              <dd>
                <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs">Authorization: Bearer pik_…</code>
              </dd>
              <dt className="text-muted-foreground">{t("api.usage.mcp")}</dt>
              <dd className="text-muted-foreground">{t("api.usage.mcpHint")}</dd>
              <dt className="text-muted-foreground">{t("api.usage.secrets")}</dt>
              <dd className="text-muted-foreground">{t("api.usage.secretsHint")}</dd>
            </dl>
          </CardContent>
        </Card>

        {canManage ? (
          <TableCard title={t("api.keys.title")} action={t("api.keys.count", { count: keys.length })}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("api.keys.columns.name")}</TableHead>
                  <TableHead>{t("api.keys.columns.prefix")}</TableHead>
                  <TableHead>{t("api.keys.columns.scope")}</TableHead>
                  <TableHead>{t("api.keys.columns.status")}</TableHead>
                  <TableHead>{t("api.keys.columns.createdBy")}</TableHead>
                  <TableHead>{t("api.keys.columns.expiresAt")}</TableHead>
                  <TableHead>{t("api.keys.columns.lastUsedAt")}</TableHead>
                  <TableHead className="text-right">{t("api.keys.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.length === 0 ? (
                  <EmptyRow colSpan={8} message={t("api.keys.empty")} />
                ) : (
                  keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.name}</TableCell>
                      <TableCell>
                        <code className="font-mono text-xs text-muted-foreground">{k.prefix}…</code>
                      </TableCell>
                      <TableCell>{t(`api.scope.${k.scope}`)}</TableCell>
                      <TableCell>
                        <StatusTag tone={STATUS_TONE[k.status]}>{t(`api.status.${k.status}`)}</StatusTag>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{k.createdBy ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {k.expiresAt ? formatDate(k.expiresAt) : t("api.keys.never")}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums">
                        {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : t("api.keys.neverUsed")}
                      </TableCell>
                      <TableCell className="text-right">
                        {k.status === "revoked" ? null : <RevokeApiKeyButton id={k.id} name={k.name} />}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableCard>
        ) : (
          <p className="text-sm text-muted-foreground">{t("api.readOnlyNote")}</p>
        )}
      </SettingsBody>
    </>
  );
}
