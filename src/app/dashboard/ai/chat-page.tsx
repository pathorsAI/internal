import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAiConversation, listAiConversations, listAiMessages } from "@/db/ai";
import { toUiMessages } from "@/lib/ai/history";
import { listUserOrgsWithRoles } from "@/db/current-org";
import { bestRole, canUseWrites } from "@/lib/ai/tool-policy";
import type { UiMessage } from "@/lib/ai/types";
import { requireOrgWithRole } from "@/lib/session";
import { AiChat } from "./ai-chat";

/** /dashboard/ai 與 /dashboard/ai/[id] 共用：左側歷史對話、右側對話區。 */
export async function AiChatPage({ conversationId }: Readonly<{ conversationId?: string }>) {
  const t = await getTranslations("ai");
  const { orgId, userId, role, session } = await requireOrgWithRole();
  const owner = { orgId, userId };
  // 對話列的是本人在所有組織的對話；組織清單給確認卡顯示組織、一鍵換組織用。
  const [conversations, current, orgs] = await Promise.all([
    listAiConversations(owner),
    conversationId ? getAiConversation(owner, conversationId) : Promise.resolve(null),
    listUserOrgsWithRoles(userId),
  ]);
  if (conversationId && !current) notFound();
  const messages: UiMessage[] = current ? toUiMessages(await listAiMessages(current.id)) : [];

  return (
    <>
      {/* 不放 PageHeader（頁名 breadcrumb 已經有了），對話區直接貼齊頂部 header；標題留給讀螢幕的人。 */}
      <h1 className="sr-only">{t("title")}</h1>
      <AiChat
        key={current?.id ?? "new"}
        conversationId={current?.id ?? null}
        initialMessages={messages}
        initialConversations={conversations.map((c) => ({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
          channel: c.channel,
        }))}
        canWrite={canUseWrites(role) || canUseWrites(bestRole(orgs.map((o) => o.role)))}
        user={{ name: session.user.name, image: session.user.image ?? null }}
        orgScope={{
          currentOrgId: orgId,
          orgs: orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, logo: o.logo })),
        }}
      />
    </>
  );
}
