import { avatarNotFound, avatarResponse } from "./avatar-response";
import { readOwnerAvatar } from "./owner-avatar-store";
import { isOrgMember, ownerAvatarDeps, sharesOrgWith } from "./owner-avatar-deps";
import { isOwnerId, type OwnerKind } from "./owner-avatar";
import { getSession } from "./session";

/**
 * /api/orgs/<id>/logo 與 /api/users/<id>/avatar 共用：先確認登入、再確認看得到（組織 → 是成員；
 * 使用者 → 本人或同組織），才從儲存串流。看不到、不存在、沒有圖一律 404，分不出差別。
 * Content-Type 由 key 的副檔名決定，而 key 只會由 server 依 magic bytes 驗過的格式產生。
 */
export async function serveOwnerAvatar(kind: OwnerKind, id: string): Promise<Response> {
  if (!isOwnerId(id)) return avatarNotFound();
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const viewer = session.user.id;
  const allowed = kind === "org" ? await isOrgMember(viewer, id) : await sharesOrgWith(viewer, id);
  if (!allowed) return avatarNotFound();
  const img = await readOwnerAvatar(ownerAvatarDeps(), { kind, id });
  return img ? avatarResponse(img.body, img.contentType) : avatarNotFound();
}
