import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/config";
import { LegalDoc } from "../legal-doc";
import { PrivacyEn } from "./content-en";
import { PrivacyZhTw } from "./content-zh-tw";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.privacy");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
  };
}

/**
 * 公開的隱私權政策（免登入，見 src/proxy.ts 的 matcher），同時是 MCP
 * RFC 9728 metadata 的 `resource_policy_uri` 預設值（見 ../.well-known/metadata.ts）。
 *
 * 語系跟 landing 走同一套：cookie 有選過就聽 cookie，沒有就依 Accept-Language 判斷
 * （見 src/i18n/locale.ts —— 對不上的語系一律給英文）。導覽列有語言切換器，所以
 * ChatGPT／Claude 的 directory 審查者可以直接切到自己讀得懂的版本。
 *
 * 條文本體在 ./content-zh-tw.tsx 與 ./content-en.tsx，兩份要一起改。
 */
export default async function PrivacyPage() {
  const locale = (await getLocale()) as Locale;

  return (
    <LegalDoc doc="privacy">
      {locale === "en" ? <PrivacyEn /> : <PrivacyZhTw />}
    </LegalDoc>
  );
}
