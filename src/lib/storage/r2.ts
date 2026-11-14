import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { StorageDriver } from "./types";

/**
 * Cloudflare R2（Workers binding `STORAGE`）。我們自己部署在 Workers 上用的就是這個。
 *
 * bucket 每次呼叫才去拿：getCloudflareContext() 綁的是當下這個 request，
 * 在模組層快取 binding 會拿到上一個 request 的 context。
 */
export function r2Driver(): StorageDriver {
  const bucket = () => getCloudflareContext().env.STORAGE;
  return {
    name: "r2",
    async put(key, body, { contentType, onlyIfEtag }) {
      const res = await bucket().put(key, body, {
        httpMetadata: { contentType },
        ...(onlyIfEtag ? { onlyIf: { etagMatches: onlyIfEtag } } : {}),
      });
      // 條件不成立時 R2 回 null。
      return res !== null;
    },
    async get(key) {
      const obj = await bucket().get(key);
      if (!obj) return null;
      return {
        body: obj.body as ReadableStream<Uint8Array>,
        contentType: obj.httpMetadata?.contentType ?? null,
        etag: obj.etag,
      };
    },
    async delete(key) {
      await bucket().delete(key);
    },
  };
}

/** 這個 runtime 有沒有 R2 binding。Worker 外（next start / Docker）getCloudflareContext() 會 throw。 */
export function hasR2Binding(): boolean {
  try {
    return Boolean(getCloudflareContext().env.STORAGE);
  } catch {
    return false;
  }
}
