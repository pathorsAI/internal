import { getCloudflareContext } from "@opennextjs/cloudflare";

function bucket() {
  return getCloudflareContext().env.STORAGE;
}

/** 把上傳的檔案存到 R2，回傳這次的 key（失敗會 throw）。 */
export async function uploadDocument(
  file: File,
  prefix: string,
): Promise<{ key: string; fileName: string; contentType: string; size: number }> {
  const safeName = file.name.replaceAll(/[^\w.-]+/g, "_").slice(-120) || "file";
  const key = `${prefix}/${crypto.randomUUID()}-${safeName}`;
  const body = await file.arrayBuffer();
  await bucket().put(key, body, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });
  return {
    key,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
  };
}

/** 刪除 R2 物件（找不到也算成功）。 */
export async function deleteDocument(key: string): Promise<void> {
  await bucket().delete(key);
}
