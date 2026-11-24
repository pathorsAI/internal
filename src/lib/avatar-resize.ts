import { AVATAR_MAX_UPLOAD_BYTES, AVATAR_SIZE } from "./party-avatar";

/** 瀏覽器端的頭像處理（交易對象、組織 logo、使用者頭像共用）。只能在 client 用。 */

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * 置中裁成正方形、縮到 256×256，優先輸出 WebP；瀏覽器不會編 WebP（toBlob 會默默退回 PNG）
 * 時改出 JPEG（墊白底，透明處才不會變黑）。品質由高往低試，直到 ≤ 200 KB。
 */
export async function resizeToSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();

  const qualities = [0.9, 0.8, 0.65, 0.5];
  for (const q of qualities) {
    const blob = await canvasToBlob(canvas, "image/webp", q);
    if (blob?.type !== "image/webp") break; // 不支援 WebP 編碼
    if (blob.size <= AVATAR_MAX_UPLOAD_BYTES) return blob;
  }

  const flat = document.createElement("canvas");
  flat.width = AVATAR_SIZE;
  flat.height = AVATAR_SIZE;
  const fctx = flat.getContext("2d");
  if (!fctx) throw new Error("canvas unavailable");
  fctx.fillStyle = "#ffffff";
  fctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  fctx.drawImage(canvas, 0, 0);
  for (const q of qualities) {
    const blob = await canvasToBlob(flat, "image/jpeg", q);
    if (blob && blob.size <= AVATAR_MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error("image too large after resize");
}

/** 剪貼簿 / 拖曳進來的第一個圖片檔。 */
export function firstImageFile(list: DataTransferItemList | null | undefined): File | null {
  if (!list) return null;
  for (const item of Array.from(list)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

