import { requireOrg } from "@/lib/session";
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
  if (!avatar) {
    return new Response("Not found", {
      status: 404,
      // 404 也不要被快取住：使用者剛上傳完，下一次就該拿得到
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(avatar.body, {
    headers: {
      "Content-Type": avatar.contentType,
      "X-Content-Type-Options": "nosniff",
      // 網址帶 ?v=<avatar_updated_at>，換圖就換網址，所以可以放心快取一天。
      // private：組織私有資料，不能進共用快取（CDN / proxy）。
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": "inline",
      "X-Robots-Tag": "noindex, nofollow",
      // 圖片本來就不會執行腳本；這條是萬一被當成文件開啟時的第二道保險。
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
