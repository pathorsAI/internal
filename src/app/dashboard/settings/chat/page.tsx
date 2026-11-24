import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { CHAT_PROVIDERS, listChatIdentitiesForUser } from "@/db/chat";
import { listMyOrgs } from "@/db/queries";
import { isChannelEnabled } from "@/lib/channels/config";
import { requireOrg } from "@/lib/session";
import { SettingsBody } from "../settings-body";
import { ChatAccountsTable, type ChatAccountRow } from "./chat-accounts-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings.chat");
  return { title: t("metaTitle") };
}

/**
 * 聊天帳號：把自己的 LINE／WhatsApp 綁到 internal，之後在手機上直接跟 AI 助理記帳。
 * 綁定是個人的，所有成員都看得到這頁、只看得到自己的綁定。
 */
export default async function ChatAccountsPage() {
  const t = await getTranslations("settings.chat");
  const { userId, orgId } = await requireOrg();
  const [identities, myOrgs] = await Promise.all([listChatIdentitiesForUser(userId), listMyOrgs(userId)]);
  const orgName = new Map(myOrgs.map((o) => [o.id, o.name]));

  const rows: ChatAccountRow[] = CHAT_PROVIDERS.map((provider) => {
    const identity = identities.find((i) => i.provider === provider) ?? null;
    return {
      provider,
      enabled: isChannelEnabled(provider),
      identity: identity
        ? {
            displayName: identity.displayName,
            orgName: identity.activeOrgId ? (orgName.get(identity.activeOrgId) ?? null) : null,
            createdAt: identity.createdAt,
            lastSeenAt: identity.lastSeenAt,
          }
        : null,
    };
  });

  return (
    <>
      <PageHeader title={t("title")} />
      <SettingsBody>
        <ChatAccountsTable rows={rows} currentOrgName={orgName.get(orgId) ?? ""} />
      </SettingsBody>
    </>
  );
}
