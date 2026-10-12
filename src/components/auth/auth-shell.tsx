import Link from "next/link";
import { useTranslations } from "next-intl";
import { LogoMark } from "@/components/logo";
import { AuthLocaleSwitcher } from "./auth-locale-switcher";
import { AuthShowcase } from "./auth-showcase";

/**
 * 帳號頁面（登入、註冊、忘記密碼、重設密碼、設定密碼）共用的版面：左邊是表單，
 * 右邊是深藍底的產品展示（AuthShowcase）。lg 以下只剩表單，置中滿版。
 *
 * 左半邊跟著 app 的主題 token 走（bg-background / text-foreground…），右半邊永遠是
 * 深色。只用到 useTranslations（server / client 都能用），所以兩種元件裡都能放。
 *
 * 欄位與按鈕在這幾頁一律 h-11（各表單自己加 className），共用的 ui 元件不動。
 */
export function AuthShell({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: string; children: React.ReactNode }>) {
  const t = useTranslations("legal");
  return (
    <div className="flex min-h-svh flex-1 bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
      <div className="flex min-h-svh w-full flex-col px-4 sm:px-8 lg:px-12">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <LogoMark className="size-7" />
            <span className="text-base font-semibold tracking-tight">Internal</span>
          </Link>
          <AuthLocaleSwitcher />
        </header>

        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[360px]">
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
            {description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
            )}
            <div className="mt-8">{children}</div>
          </div>
        </main>

        <footer className="flex h-14 shrink-0 items-center justify-center gap-5 text-xs text-muted-foreground lg:justify-start">
          <Link href="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
            {t("privacy.title")}
          </Link>
          <Link href="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
            {t("terms.title")}
          </Link>
        </footer>
      </div>

      <div className="hidden p-3 lg:sticky lg:top-0 lg:block lg:h-svh">
        <AuthShowcase className="h-full" />
      </div>
    </div>
  );
}
