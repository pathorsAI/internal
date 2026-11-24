import type { AvatarImageType } from "./party-avatar";

/** 頭像讀取 API 共用的回應（交易對象、組織 logo、使用者頭像同一套 header）。 */
export function avatarNotFound(): Response {
  // 404 也不要被快取：剛上傳完，下一次就該拿得到
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}

export function avatarResponse(body: ReadableStream, contentType: AvatarImageType): Response {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
      // 網址帶 ?v=<上傳時間>，換圖就換網址，可以放心快取一天；private：不能進共用快取。
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": "inline",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
