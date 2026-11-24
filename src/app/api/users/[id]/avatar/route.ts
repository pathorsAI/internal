import { avatarNotFound, avatarResponse } from "@/lib/avatar-response";
import { readOwnerAvatar } from "@/lib/owner-avatar-store";
import { ownerAvatarDeps, sharesOrgWith } from "@/lib/owner-avatar-deps";
import { isOwnerId } from "@/lib/owner-avatar";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 使用者頭像（bucket 非公開）。本人，或跟這位使用者至少同在一個組織的人才拿得到；
 * 其餘一律 404。Content-Type 由 key 的副檔名決定。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isOwnerId(id)) return avatarNotFound();
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!(await sharesOrgWith(session.user.id, id))) return avatarNotFound();
  const avatar = await readOwnerAvatar(ownerAvatarDeps(), { kind: "user", id });
  return avatar ? avatarResponse(avatar.body, avatar.contentType) : avatarNotFound();
}
