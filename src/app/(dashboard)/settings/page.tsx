import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="設定" description="系統與整合設定" />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">驗證 (OAuth)</CardTitle>
          <CardDescription>
            目前尚未啟用登入。之後會接上 OAuth，限定 pathors.com 帳號登入。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          佔位頁面 — 之後在這裡管理整合、API 金鑰與同步設定。
        </CardContent>
      </Card>
    </>
  );
}
