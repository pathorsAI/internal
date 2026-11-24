import { avatarNotFound, avatarResponse } from "@/lib/avatar-response";
import { readOwnerAvatar } from "@/lib/owner-avatar-store";
import { isOrgMember, ownerAvatarDeps } from "@/lib/owner-avatar-deps";
import { isOwnerId } from "@/lib/owner-avatar";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 組織 logo（bucket 非公開，一律透過這裡取用）。只有該組織的成員拿得到；
 * 不是成員、組織不存在、沒有 logo 一律 404，分不出差別。
 * Content-Type 由 key 的副檔名決定，而 key 只會由 server 依 magic bytes 驗過的格式產生。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isOwnerId(id)) return avatarNotFound();
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!(await isOrgMember(session.user.id, id))) return avatarNotFound();
  const logo = await readOwnerAvatar(ownerAvatarDeps(), { kind: "org", id });
  return logo ? avatarResponse(logo.body, logo.contentType) : avatarNotFound();
}
