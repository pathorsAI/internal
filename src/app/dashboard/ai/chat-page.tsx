import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getAiConversation, listAiConversations, listAiMessages } from "@/db/ai";
import { toUiMessages } from "@/lib/ai/history";
import { canUseWrites } from "@/lib/ai/tool-policy";
import type { UiMessage } from "@/lib/ai/types";
import { requireOrgWithRole } from "@/lib/session";
import { AiChat } from "./ai-chat";

/** /dashboard/ai 與 /dashboard/ai/[id] 共用：左側歷史對話、右側對話區。 */
export async function AiChatPage({ conversationId }: Readonly<{ conversationId?: string }>) {
  const t = await getTranslations("ai");
  const { orgId, userId, role } = await requireOrgWithRole();
  const owner = { orgId, userId };
  const [conversations, current] = await Promise.all([
    listAiConversations(owner),
    conversationId ? getAiConversation(owner, conversationId) : Promise.resolve(null),
  ]);
  if (conversationId && !current) notFound();
  const messages: UiMessage[] = current ? toUiMessages(await listAiMessages(current.id)) : [];

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <AiChat
        key={current?.id ?? "new"}
        conversationId={current?.id ?? null}
        initialMessages={messages}
        initialConversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
        }))}
        canWrite={canUseWrites(role)}
      />
    </>
  );
}
