"use server";

import {
  createChatLinkCode,
  isChatProvider,
  listChatIdentitiesForUser,
  unlinkChatIdentityForUser,
  type ChatProvider,
} from "@/db/chat";
import { isChannelEnabled } from "@/lib/channels/config";
import { bindMessage, chatOpenUrl } from "@/lib/channels/links";
import { requireOrg } from "@/lib/session";

/**
 * 聊天帳號（LINE／WhatsApp）的 server action。綁定是個人的：只動得到本人的綁定，
 * 所以只要登入、有組織就好，不看組織角色（跟 MCP 授權頁一樣）。
 */

export type LinkCodeResult =
  | {
      ok: true;
      code: string;
      expiresAt: string;
      /** 開啟 bot 對話、預填「綁定 123456」的連結（QR code 也是它）。 */
      openUrl: string | null;
      /** 要傳給 bot 的那句話（沒辦法用連結時手動輸入）。 */
      message: string;
    }
  | { ok: false; error: "disabled" | "bad_request" | "failed" };

/** 產生 6 位數綁定碼（作廢這個人在這個平台還沒用掉的舊碼）。綁定後 bot 預設操作目前這個組織。 */
export async function createLinkCode(provider: ChatProvider): Promise<LinkCodeResult> {
  if (!isChatProvider(provider)) return { ok: false, error: "bad_request" };
  if (!isChannelEnabled(provider)) return { ok: false, error: "disabled" };
  const { orgId, userId } = await requireOrg();
  try {
    const { code, expiresAt } = await createChatLinkCode({ userId, orgId, provider });
    return { ok: true, code, expiresAt, openUrl: chatOpenUrl(provider, code), message: bindMessage(code) };
  } catch (e) {
    console.error("[settings/chat] createLinkCode", e);
    return { ok: false, error: "failed" };
  }
}

/** 設定頁開著綁定碼時輪詢：這個平台綁好了沒。 */
export async function chatBindingStatus(provider: ChatProvider): Promise<{ bound: boolean }> {
  if (!isChatProvider(provider)) return { bound: false };
  const { userId } = await requireOrg();
  const rows = await listChatIdentitiesForUser(userId);
  return { bound: rows.some((r) => r.provider === provider) };
}

/** 解除本人在這個平台的綁定（bot 之後就不認得這個聊天帳號，要重新綁）。 */
export async function unlinkChatAccount(provider: ChatProvider): Promise<{ ok: boolean }> {
  if (!isChatProvider(provider)) return { ok: false };
  const { userId } = await requireOrg();
  return { ok: await unlinkChatIdentityForUser(userId, provider) };
}
