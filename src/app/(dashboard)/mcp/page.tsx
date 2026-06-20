import { headers } from "next/headers";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listMcpClients, getMemberRole } from "@/db/queries";
import { formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { RevokeClientButton } from "./revoke-client-button";

export const dynamic = "force-dynamic";

const typeLabel: Record<string, string> = {
  web: "Web",
  native: "原生 App",
  "user-agent-based": "瀏覽器",
  public: "Public",
};

export default async function McpPage() {
  const { orgId, userId } = await requireOrg();
  const [clients, role, h] = await Promise.all([
    listMcpClients(),
    getMemberRole(orgId, userId),
    headers(),
  ]);
  const canManage = role === "owner" || role === "admin";

  const host = h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const mcpUrl = `${origin}/api/mcp`;
  const discoveryUrl = `${origin}/.well-known/oauth-authorization-server`;

  const colSpan = canManage ? 7 : 6;

  return (
    <>
      <PageHeader
        title="MCP"
        description="把這個系統接到 Claude 等 MCP 用戶端，用對話查詢專案、訂閱、應收帳款與待收的款項"
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>連線資訊</CardTitle>
            <CardDescription>
              在 Claude 新增一個 connector，網址填下面這個。第一次連線會跳出 Google
              登入授權（跟後台同一個帳號），之後就能用對話查資料。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">MCP 伺服器網址</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-md border bg-muted px-3 py-2 text-sm">
                  {mcpUrl}
                </code>
                <CopyButton value={mcpUrl} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              OAuth 探索端點：<code className="text-xs">{discoveryUrl}</code>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>已連線的用戶端（{clients.length}）</CardTitle>
            <CardDescription>
              每個連線到 MCP 的 app 會在這裡列出（透過 OAuth 動態註冊）。
              {canManage
                ? "撤銷後對方需要重新授權。"
                : "撤銷需要擁有者或管理員權限。"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名稱</TableHead>
                  <TableHead>Client ID</TableHead>
                  <TableHead>類型</TableHead>
                  <TableHead className="text-right">有效連線</TableHead>
                  <TableHead>狀態</TableHead>
                  <TableHead>建立時間</TableHead>
                  {canManage && <TableHead className="text-right">動作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={colSpan}
                      className="text-center text-muted-foreground"
                    >
                      目前沒有任何 MCP 用戶端。把上面的網址加到 Claude 後就會出現在這裡。
                    </TableCell>
                  </TableRow>
                ) : (
                  clients.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.name || "（未命名）"}
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
                          {c.disabled ? "停用" : "啟用"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(c.createdAt)}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <RevokeClientButton
                            clientId={c.clientId}
                            name={c.name || "未命名用戶端"}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
