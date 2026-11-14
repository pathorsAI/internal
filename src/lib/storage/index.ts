import { resolveStorageConfig } from "./config";
import { hasR2Binding, r2Driver } from "./r2";
import type { StorageDriver, StoredObjectStream } from "./types";

export type { StorageDriver, StoredObjectStream } from "./types";

/**
 * 檔案儲存的唯一入口。driver（r2 / s3 / fs）由 config.ts 依環境變數決定，
 * 呼叫端只認這裡匯出的函式，不直接碰 R2 binding 或 S3。
 *
 * 快取 driver：設定在 process 生命週期內不會變，不用每個 request 重新解析 env。
 * 例外是 r2 —— 它自己每次呼叫才去拿 binding（見 r2.ts），所以快取 driver 物件是安全的。
 * 解析失敗不快取，改好設定後不用重啟就會重試（主要是本機開發時好用）。
 */
let driverPromise: Promise<StorageDriver> | null = null;

async function createDriver(): Promise<StorageDriver> {
  const cfg = resolveStorageConfig(process.env, hasR2Binding());
  switch (cfg.driver) {
    case "r2":
      return r2Driver();
    case "s3": {
      const { s3Driver } = await import("./s3");
      return s3Driver(cfg.s3);
    }
    case "fs": {
      // 動態 import：Workers 上永遠不會選到 fs，不讓它（與它的 node:fs）進到熱路徑。
      const { fsDriver } = await import("./fs");
      return fsDriver(cfg.dir);
    }
  }
}

export function getStorage(): Promise<StorageDriver> {
  driverPromise ??= createDriver().catch((e) => {
    driverPromise = null;
    throw e;
  });
  return driverPromise;
}

/** 把上傳的檔案存進物件儲存，回傳這次的 key（失敗會 throw）。 */
export async function uploadDocument(
  file: File,
  prefix: string,
): Promise<{ key: string; fileName: string; contentType: string; size: number }> {
  const safeName = file.name.replaceAll(/[^\w.-]+/g, "_").slice(-120) || "file";
  const key = `${prefix}/${crypto.randomUUID()}-${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const body = new Uint8Array(await file.arrayBuffer());
  await (await getStorage()).put(key, body, { contentType });
  return { key, fileName: file.name, contentType, size: file.size };
}

/** 刪除物件（找不到也算成功）。 */
export async function deleteDocument(key: string): Promise<void> {
  await (await getStorage()).delete(key);
}

/** 寫入一個物件（key 由呼叫端決定；失敗會 throw）。 */
export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await (await getStorage()).put(key, body, { contentType });
}

/** 讀取一個物件的串流；不存在回 null。 */
export async function getObjectStream(key: string): Promise<ReadableStream | null> {
  const obj = await (await getStorage()).get(key);
  return obj ? obj.body : null;
}

/** 讀取物件連同 metadata（Content-Type、etag）；不存在回 null。 */
export async function getObject(key: string): Promise<StoredObjectStream | null> {
  return (await getStorage()).get(key);
}
