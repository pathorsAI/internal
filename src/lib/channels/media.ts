/**
 * 收件匣檔案的共用規則：聊天 bot（dispatcher.ts）與 MCP upload_document 收同一套型別與大小上限。
 */

/** 單檔上限（跟模型讀附件的上限一樣）。 */
export const CHAT_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** 平台給的 mime 不可靠（LINE 檔案常是 octet-stream）：用副檔名補。 */
export function normalizeMime(mime: string | undefined, fileName?: string): string {
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (m && m !== "application/octet-stream" && m !== "binary/octet-stream") return m;
  const ext = fileName?.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "gif") return "image/gif";
  return m || "application/octet-stream";
}

export function isAcceptedMime(mime: string): boolean {
  return mime.startsWith("image/") || mime === "application/pdf";
}

/** 物件儲存 key 用的檔名：只留英數、底線、點、連字號，最多 120 字。 */
export function safeFileName(name: string): string {
  return name.replaceAll(/[^\w.-]+/g, "_").slice(-120) || "file";
}
