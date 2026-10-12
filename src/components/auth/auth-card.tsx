import { LogoMark } from "@/components/logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 登入以外的帳號頁面（註冊、忘記密碼、重設密碼、設定密碼）共用的外框，長得跟
 * /login 一模一樣：置中的窄卡片、上方 logo。沒有 hooks，server / client 都能用。
 */
export function AuthCard({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: string; children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <LogoMark className="size-10 mb-2" />
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
