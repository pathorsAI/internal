import { requireOrg } from "@/lib/session";
import { avatarNotFound, avatarResponse } from "@/lib/avatar-response";
import { readPartyAvatar } from "@/lib/party-avatar-store";
import { partyAvatarDeps } from "@/lib/party-avatar-deps";

export const dynamic = "force-dynamic";

/**
 * 交易對象頭像（bucket 非公開，一律透過這個 route 取用）。
 *
 * 跨租戶隔離：requireOrg() 決定呼叫者當前的組織，readPartyAvatar 只在該交易對象屬於
 * 這個組織、且 key 落在 orgs/<orgId>/parties/<id>/ 底下時才去 R2 拿 —— 拿別的組織的
 * id 來猜只會得到 404，跟沒有頭像分不出來。
 *
 * Content-Type 不看 R2 上存的 metadata，而是由 key 的副檔名決定，而 key 只會由
 * server 依 magic bytes 驗過的格式產生（PNG / JPEG / WebP，沒有 SVG）。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const partyId = Number(id);
  if (!Number.isSafeInteger(partyId) || partyId <= 0) {
    return new Response("Bad id", { status: 400 });
  }

  const { orgId } = await requireOrg();
  const avatar = await readPartyAvatar(partyAvatarDeps(), { orgId, partyId });
  return avatar ? avatarResponse(avatar.body, avatar.contentType) : avatarNotFound();
}
