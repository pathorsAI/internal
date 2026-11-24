import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AiChatPage } from "./chat-page";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ai");
  return { title: t("metaTitle") };
}

export default function AiPage() {
  return <AiChatPage />;
}
