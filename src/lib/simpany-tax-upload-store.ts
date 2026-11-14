import { getStorage } from "@/lib/storage";
import type { TaxUploadStore } from "./simpany-tax-upload";

/**
 * 正式環境的 TaxUploadStore：走共用的物件儲存（與 documents 同一個 bucket / 目錄，前綴 simpany-tax/）。
 * 底下是 R2、S3 或本機目錄由 src/lib/storage 決定；單次使用靠的條件寫入三個 driver 都有實作。
 */
export function taxUploadStore(): TaxUploadStore {
  return {
    async get(key) {
      const obj = await (await getStorage()).get(key);
      if (!obj) return null;
      return { bytes: new Uint8Array(await new Response(obj.body).arrayBuffer()), etag: obj.etag };
    },
    async put(key, bytes, contentType, onlyIfEtag) {
      return (await getStorage()).put(key, bytes, { contentType, onlyIfEtag });
    },
    async delete(key) {
      await (await getStorage()).delete(key);
    },
    now: () => new Date(),
    token() {
      const b = new Uint8Array(32);
      crypto.getRandomValues(b);
      return btoa(String.fromCodePoint(...b)).replaceAll("+", "-").replaceAll("/", "_").split("=")[0];
    },
  };
}
