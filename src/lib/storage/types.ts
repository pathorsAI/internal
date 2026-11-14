/**
 * 物件儲存的 driver 介面。
 *
 * 為什麼抽這一層：原本整個檔案儲存只認 Cloudflare R2 的 Workers binding
 * （`env.STORAGE`），那個 binding 只在 Worker 裡存在，自架（Docker / 一般 Node）的人
 * 一上傳就炸。這裡只收「現有呼叫端真的用到的能力」：寫入（含條件寫入）、讀串流、刪除。
 * 刻意不做 list / head / multipart —— 沒有人用，多一個方法就多三份實作要維護。
 */

export type PutOptions = {
  contentType: string;
  /**
   * 有給時是條件寫入：只有物件目前的 etag 等於這個值才寫。
   * simpany 稅務上傳靠它保證「一次性網址只能用一次」與「草稿只能送出一次」。
   * etag 的格式是 driver 自己的（R2 不帶引號、S3 帶引號、fs 是 sha256），
   * 呼叫端只能拿同一個 driver 的 get() 回來的值原封不動傳回來，不要自己算。
   */
  onlyIfEtag?: string;
};

export type StoredObjectStream = {
  body: ReadableStream<Uint8Array>;
  contentType: string | null;
  etag: string;
};

export interface StorageDriver {
  readonly name: "r2" | "s3" | "fs";
  /** 寫入物件；條件寫入不成立回 false，其他失敗 throw。 */
  put(key: string, body: Uint8Array, opts: PutOptions): Promise<boolean>;
  /** 讀物件；不存在回 null。 */
  get(key: string): Promise<StoredObjectStream | null>;
  /** 刪除物件；不存在也算成功。 */
  delete(key: string): Promise<void>;
}
