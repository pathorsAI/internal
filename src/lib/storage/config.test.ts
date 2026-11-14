import { describe, expect, test } from "bun:test";
import { DEFAULT_FS_DIR, resolveStorageConfig, StorageConfigError } from "./config";

const S3_ENV = {
  S3_BUCKET: "docs",
  S3_ACCESS_KEY_ID: "AKID",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("resolveStorageConfig: defaults", () => {
  test("R2 binding present → r2, regardless of NODE_ENV", () => {
    expect(resolveStorageConfig({ NODE_ENV: "production" }, true)).toEqual({ driver: "r2" });
    expect(resolveStorageConfig({ NODE_ENV: "development" }, true)).toEqual({ driver: "r2" });
  });

  test("no binding, not production → fs at ./data/storage", () => {
    expect(resolveStorageConfig({ NODE_ENV: "development" }, false)).toEqual({ driver: "fs", dir: DEFAULT_FS_DIR });
    expect(resolveStorageConfig({}, false)).toEqual({ driver: "fs", dir: DEFAULT_FS_DIR });
    expect(resolveStorageConfig({ NODE_ENV: "test", STORAGE_DIR: "/tmp/x" }, false)).toEqual({ driver: "fs", dir: "/tmp/x" });
  });

  test("no binding, production, nothing configured → clear error (never silent local disk)", () => {
    expect(() => resolveStorageConfig({ NODE_ENV: "production" }, false)).toThrow(StorageConfigError);
    expect(() => resolveStorageConfig({ NODE_ENV: "production" }, false)).toThrow(/STORAGE_DRIVER/);
    // STORAGE_DIR 單獨出現不算明確選 fs。
    expect(() => resolveStorageConfig({ NODE_ENV: "production", STORAGE_DIR: "/data" }, false)).toThrow(StorageConfigError);
  });
});

describe("resolveStorageConfig: explicit STORAGE_DRIVER", () => {
  test("fs in production is allowed when explicit", () => {
    expect(resolveStorageConfig({ NODE_ENV: "production", STORAGE_DRIVER: "fs", STORAGE_DIR: "/app/data/storage" }, false)).toEqual({
      driver: "fs",
      dir: "/app/data/storage",
    });
    expect(resolveStorageConfig({ NODE_ENV: "production", STORAGE_DRIVER: "FS" }, false)).toEqual({ driver: "fs", dir: DEFAULT_FS_DIR });
  });

  test("explicit driver wins over the R2 binding", () => {
    expect(resolveStorageConfig({ STORAGE_DRIVER: "fs" }, true).driver).toBe("fs");
    expect(resolveStorageConfig({ STORAGE_DRIVER: "s3", ...S3_ENV }, true).driver).toBe("s3");
  });

  test("r2 without a binding → error", () => {
    expect(() => resolveStorageConfig({ STORAGE_DRIVER: "r2" }, false)).toThrow(/R2 binding/);
  });

  test("unknown driver → error", () => {
    expect(() => resolveStorageConfig({ STORAGE_DRIVER: "gcs" }, true)).toThrow(/Unknown STORAGE_DRIVER/);
  });

  test("s3 with missing vars lists what is missing", () => {
    expect(() => resolveStorageConfig({ STORAGE_DRIVER: "s3", S3_BUCKET: "b" }, false)).toThrow(
      /S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/,
    );
  });

  test("s3 without endpoint → AWS virtual-host defaults", () => {
    const cfg = resolveStorageConfig({ STORAGE_DRIVER: "s3", ...S3_ENV, S3_REGION: "eu-west-1" }, false);
    expect(cfg).toEqual({
      driver: "s3",
      s3: {
        endpoint: "https://s3.eu-west-1.amazonaws.com",
        region: "eu-west-1",
        bucket: "docs",
        accessKeyId: "AKID",
        secretAccessKey: "secret",
        forcePathStyle: false,
      },
    });
  });

  test("s3 with custom endpoint defaults to path style; S3_FORCE_PATH_STYLE overrides", () => {
    const minio = resolveStorageConfig({ STORAGE_DRIVER: "s3", ...S3_ENV, S3_ENDPOINT: "http://minio:9000" }, false);
    expect(minio.driver === "s3" && minio.s3.forcePathStyle).toBe(true);
    expect(minio.driver === "s3" && minio.s3.region).toBe("us-east-1");

    const vhost = resolveStorageConfig(
      { STORAGE_DRIVER: "s3", ...S3_ENV, S3_ENDPOINT: "https://s3.example.com", S3_FORCE_PATH_STYLE: "false" },
      false,
    );
    expect(vhost.driver === "s3" && vhost.s3.forcePathStyle).toBe(false);

    expect(() => resolveStorageConfig({ STORAGE_DRIVER: "s3", ...S3_ENV, S3_FORCE_PATH_STYLE: "maybe" }, false)).toThrow(
      /S3_FORCE_PATH_STYLE/,
    );
  });

  test("s3 with an invalid endpoint → error", () => {
    expect(() => resolveStorageConfig({ STORAGE_DRIVER: "s3", ...S3_ENV, S3_ENDPOINT: "not a url" }, false)).toThrow(/S3_ENDPOINT/);
  });
});
