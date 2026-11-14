import type { S3Config } from "./s3";

/**
 * 決定要用哪個 storage driver。純函式（吃 env 與「有沒有 R2 binding」），方便測試。
 *
 * 規則：
 *   - STORAGE_DRIVER 有設就照它（r2 / s3 / fs），缺必要設定直接 throw。
 *   - 沒設：有 R2 binding → r2（我們自己的 Workers 部署，零設定）。
 *   - 沒設、沒 binding、非 production → fs，目錄 STORAGE_DIR 或 ./data/storage。
 *   - 沒設、沒 binding、production → throw。
 *
 * 為什麼 production 不默默退回本機目錄：在容器裡寫進沒掛 volume 的路徑，檔案會在下次
 * 重建容器時整批消失，而且一開始完全看不出來——憑證、合約掃描檔這種東西掉了是追不回來的。
 * 寧可第一次上傳就看到清楚的錯誤訊息。要用本機目錄就明確寫 STORAGE_DRIVER=fs。
 */

export const DEFAULT_FS_DIR = "./data/storage";

export type StorageConfig = { driver: "r2" } | { driver: "s3"; s3: S3Config } | { driver: "fs"; dir: string };

type Env = Record<string, string | undefined>;

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(`[storage] ${message} See docs/deployment.md#file-storage.`);
    this.name = "StorageConfigError";
  }
}

function nonEmpty(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t || undefined;
}

function parseBool(v: string | undefined): boolean | undefined {
  const t = nonEmpty(v)?.toLowerCase();
  if (t === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  throw new StorageConfigError(`S3_FORCE_PATH_STYLE must be true or false, got ${JSON.stringify(v)}.`);
}

export function resolveS3Config(env: Env): S3Config {
  const bucket = nonEmpty(env.S3_BUCKET);
  const accessKeyId = nonEmpty(env.S3_ACCESS_KEY_ID);
  const secretAccessKey = nonEmpty(env.S3_SECRET_ACCESS_KEY);
  const missing = [
    !bucket && "S3_BUCKET",
    !accessKeyId && "S3_ACCESS_KEY_ID",
    !secretAccessKey && "S3_SECRET_ACCESS_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new StorageConfigError(`STORAGE_DRIVER=s3 needs ${missing.join(", ")}.`);
  }
  const region = nonEmpty(env.S3_REGION) ?? "us-east-1";
  const explicitEndpoint = nonEmpty(env.S3_ENDPOINT);
  // 沒給 endpoint 就是 AWS 本家。
  const endpoint = explicitEndpoint ?? `https://s3.${region}.amazonaws.com`;
  try {
    new URL(endpoint);
  } catch {
    throw new StorageConfigError(`S3_ENDPOINT is not a valid URL: ${JSON.stringify(endpoint)}.`);
  }
  // 自訂 endpoint（MinIO、R2、B2…）幾乎都要 path style，AWS 本家則預設 virtual-host。
  // 這樣多數人完全不用碰 S3_FORCE_PATH_STYLE。
  const forcePathStyle = parseBool(env.S3_FORCE_PATH_STYLE) ?? Boolean(explicitEndpoint);
  return {
    endpoint,
    region,
    bucket: bucket!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    forcePathStyle,
  };
}

export function resolveStorageConfig(env: Env, hasR2Binding: boolean): StorageConfig {
  const explicit = nonEmpty(env.STORAGE_DRIVER)?.toLowerCase();
  switch (explicit) {
    case "r2":
      if (!hasR2Binding) {
        throw new StorageConfigError(
          "STORAGE_DRIVER=r2 but no Cloudflare R2 binding named STORAGE is available (it only exists inside a Worker). Use STORAGE_DRIVER=s3 to reach R2 through its S3 API.",
        );
      }
      return { driver: "r2" };
    case "s3":
      return { driver: "s3", s3: resolveS3Config(env) };
    case "fs":
      return { driver: "fs", dir: nonEmpty(env.STORAGE_DIR) ?? DEFAULT_FS_DIR };
    case undefined:
      break;
    default:
      throw new StorageConfigError(`Unknown STORAGE_DRIVER ${JSON.stringify(env.STORAGE_DRIVER)} (expected r2, s3 or fs).`);
  }

  if (hasR2Binding) return { driver: "r2" };
  if (env.NODE_ENV !== "production") {
    return { driver: "fs", dir: nonEmpty(env.STORAGE_DIR) ?? DEFAULT_FS_DIR };
  }
  throw new StorageConfigError(
    "No file storage configured. Set STORAGE_DRIVER=s3 (with S3_* variables) or STORAGE_DRIVER=fs (with STORAGE_DIR on a persistent volume).",
  );
}
