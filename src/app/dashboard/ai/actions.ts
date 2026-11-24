"use server";

import { deleteAiConversation } from "@/db/ai";
import { requireOrg } from "@/lib/session";

/** 刪除自己的一段對話（連同訊息，ON DELETE CASCADE）。只刪得到本人在目前組織的。 */
export async function deleteConversation(id: string): Promise<{ ok: boolean }> {
  if (typeof id !== "string" || id.length > 64) return { ok: false };
  const { orgId, userId } = await requireOrg();
  return { ok: await deleteAiConversation({ orgId, userId }, id) };
}
