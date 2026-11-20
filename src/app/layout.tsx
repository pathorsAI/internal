import type { Metadata } from "next";
import { Inter, Noto_Sans_TC, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { LOCALES, type Locale } from "@/i18n/config";

// 拉丁字與數字用 Inter，中文用 Noto Sans TC；兩套都由 next/font 在 build 時抓下來自架，
// 執行時不連 Google。Noto Sans TC 很大，不 preload，瀏覽器依 unicode-range 只抓用到的分片。
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const notoSansTC = Noto_Sans_TC({
  variable: "--font-noto-tc",
  weight: ["400", "500", "600", "700"],
  preload: false,
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 在第一次繪製前套上主題，避免深色使用者先閃一下白底。偏好存在 localStorage 的 theme
// （"light" / "dark"；沒有或 "system" 就跟系統），切換在側欄的 ThemeSwitcher。
const themeScript = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||((!t||t==="system")&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common.meta");
  return {
    title: "Internal",
    description: t("description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = (await getLocale()) as Locale;

  return (
    <html
      lang={LOCALES[locale].htmlLang}
      className={`${inter.variable} ${notoSansTC.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
