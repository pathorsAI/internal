import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { TaxUploadStore } from "./simpany-tax-upload";

/** 正式環境的 TaxUploadStore：R2 binding STORAGE（與 documents 同一個 bucket，前綴 simpany-tax/）。 */
export function r2TaxUploadStore(): TaxUploadStore {
  const bucket = () => getCloudflareContext().env.STORAGE;
  return {
    async get(key) {
      const obj = await bucket().get(key);
      if (!obj) return null;
      return { bytes: new Uint8Array(await obj.arrayBuffer()), etag: obj.etag };
    },
    async put(key, bytes, contentType, onlyIfEtag) {
      const res = await bucket().put(key, bytes, {
        httpMetadata: { contentType },
        ...(onlyIfEtag ? { onlyIf: { etagMatches: onlyIfEtag } } : {}),
      });
      // 條件不成立時 R2 回 null。
      return res !== null;
    },
    async delete(key) {
      await bucket().delete(key);
    },
    now: () => new Date(),
    token() {
      const b = new Uint8Array(32);
      crypto.getRandomValues(b);
      return btoa(String.fromCodePoint(...b)).replaceAll("+", "-").replaceAll("/", "_").split("=")[0];
    },
  };
}
