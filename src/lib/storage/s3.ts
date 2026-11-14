import { AwsClient } from "aws4fetch";
import type { StorageDriver } from "./types";

/**
 * 任何 S3 相容的物件儲存：AWS S3、MinIO、Backblaze B2、Wasabi，或用 S3 API 接 R2。
 *
 * 為什麼用 aws4fetch 不用 @aws-sdk/client-s3：我們只要 PUT / GET / DELETE 三個動作，
 * aws4fetch 只負責 SigV4 簽章、底下就是標準 fetch，幾 KB 而且 Workers / Node / Bun
 * 都能跑；AWS SDK 會拖進一大包 Node 專用的相依，Workers bundle 也會跟著肥。
 */
export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** true：`<endpoint>/<bucket>/<key>`（MinIO 必須）；false：`<bucket>.<host>/<key>`（AWS 預設）。 */
  forcePathStyle: boolean;
};

/** 物件網址。key 每一段各自 encode，保留 `/` 當路徑分隔。 */
export function s3ObjectUrl(cfg: S3Config, key: string): string {
  const base = new URL(cfg.endpoint);
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const basePath = base.pathname.replace(/\/+$/, "");
  if (cfg.forcePathStyle) {
    return `${base.protocol}//${base.host}${basePath}/${encodeURIComponent(cfg.bucket)}/${encodedKey}`;
  }
  return `${base.protocol}//${cfg.bucket}.${base.host}${basePath}/${encodedKey}`;
}

async function failure(res: Response, action: string, key: string): Promise<Error> {
  // 只帶前 300 字：S3 的錯誤是 XML，Code/Message 都在開頭，整份塞進 log 沒有意義。
  const text = (await res.text().catch(() => "")).slice(0, 300);
  return new Error(`[storage:s3] ${action} ${key} failed: HTTP ${res.status} ${text}`);
}

export function s3Driver(cfg: S3Config, fetchImpl: typeof fetch = fetch): StorageDriver {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: cfg.region,
    // 重試交給呼叫端：條件寫入（If-Match）重送會讓「已經寫成功」看起來像 412。
    retries: 0,
  });

  // 簽好再交給 fetchImpl，而不是 client.fetch()：測試要能換掉 fetch 看簽出來的 request。
  async function send(method: string, key: string, init: RequestInit = {}): Promise<Response> {
    const req = await client.sign(s3ObjectUrl(cfg, key), { ...init, method });
    return fetchImpl(req);
  }

  return {
    name: "s3",
    async put(key, body, { contentType, onlyIfEtag }) {
      const headers: Record<string, string> = { "Content-Type": contentType };
      if (onlyIfEtag) headers["If-Match"] = onlyIfEtag;
      const res = await send("PUT", key, { body: body as Uint8Array<ArrayBuffer>, headers });
      // 412：etag 不符。404：條件寫入但物件已不存在（AWS 對 If-Match 打到不存在的 key 回 404）。
      if (onlyIfEtag && (res.status === 412 || res.status === 404)) {
        await res.body?.cancel();
        return false;
      }
      if (!res.ok) throw await failure(res, "PUT", key);
      await res.body?.cancel();
      return true;
    },
    async get(key) {
      const res = await send("GET", key);
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok || !res.body) throw await failure(res, "GET", key);
      return {
        body: res.body,
        contentType: res.headers.get("Content-Type"),
        // 保留引號原樣：之後 If-Match 要送回同一個字串。
        etag: res.headers.get("ETag") ?? "",
      };
    },
    async delete(key) {
      const res = await send("DELETE", key);
      // S3 刪不存在的 key 本來就回 204；有些相容實作回 404，一樣當成功。
      if (!res.ok && res.status !== 404) throw await failure(res, "DELETE", key);
      await res.body?.cancel();
    },
  };
}
