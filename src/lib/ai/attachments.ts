import { getOrgDocuments } from "@/db/chat";
import { getObject } from "@/lib/storage";
import { ATTACH_MAX_BYTES, attachmentPart, isModelReadable } from "./history";
import type { ContentPart } from "./openrouter";
import type { AttachmentRef } from "./types";

/**
 * 正式版的附件讀取：從 documents 確認檔案屬於這個組織，再從 STORAGE 讀出來轉成模型的內容片段。
 * 任何一個讀不到（被刪、太大、格式不對、儲存出錯）就略過，那個附件只會以文字佔位出現 ——
 * 讀附件失敗不該讓整題失敗。
 *
 * 已知限制：圖片不先縮圖（Workers 上沒有現成的影像處理），PDF 整份送（OpenRouter 自己處理頁數）。
 */
export async function readAttachmentParts(
  orgId: string,
  refs: readonly AttachmentRef[],
): Promise<Map<number, ContentPart>> {
  const out = new Map<number, ContentPart>();
  if (refs.length === 0) return out;
  const docs = await getOrgDocuments(
    orgId,
    refs.map((r) => r.documentId),
  );
  for (const d of docs) {
    if (!isModelReadable(d.contentType)) continue;
    if (d.sizeBytes !== null && d.sizeBytes > ATTACH_MAX_BYTES) continue;
    try {
      const bytes = await readLimited(d.r2Key, ATTACH_MAX_BYTES);
      if (!bytes) continue;
      const part = attachmentPart({ fileName: d.fileName, contentType: d.contentType }, bytes);
      if (part) out.set(d.id, part);
    } catch (err) {
      console.error("[ai/attachments] read failed", d.id, err);
    }
  }
  return out;
}

/** 讀整個物件，超過 max 位元組就放棄（回 null）；不存在也回 null。 */
async function readLimited(key: string, max: number): Promise<Uint8Array | null> {
  const obj = await getObject(key);
  if (!obj) return null;
  const reader = obj.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return bytes;
}
