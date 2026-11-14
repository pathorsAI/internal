import type { StorageDriver } from "./types";

/**
 * 本機目錄（STORAGE_DIR）。給本機開發與 Docker volume 用：不用開任何雲端帳號就能上傳。
 *
 * 為什麼 node:* 全部用動態 import：這個檔案會跟著 storage 模組進 Workers bundle。
 * 頂層 import node:fs 會讓 OpenNext 的 esbuild 在打包時就處理它，而 Workers 上
 * 根本不會走到這個 driver；動態 import 只在真的選了 fs 時才載入。
 *
 * 目錄配置：
 *   <root>/objects/<key>        檔案本體
 *   <root>/meta/<key>.json      { contentType, etag }
 * 本體與 metadata 分兩棵樹，任何 key（包括剛好以 .json 結尾的）都不會撞到 metadata 檔。
 * 限制：跟真的物件儲存不同，"a" 與 "a/b" 不能同時存在（一個是檔案一個是資料夾）；
 * 現有的 key 都是 `<prefix>/<uuid>-<檔名>` 這種形狀，不會遇到。
 */

type Meta = { contentType: string; etag: string };

/**
 * 驗證並正規化 key，回傳路徑片段。
 *
 * key 有一部分來自使用者（上傳的檔名），雖然 uploadDocument 已經清過，但這一層是
 * 最後一道：任何會讓路徑跑出 root 的東西都直接拒絕，而不是「修好再用」——
 * 默默修正會讓兩個不同的 key 寫到同一個檔案。
 */
export function normalizeStorageKey(key: string): string[] {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) {
    throw new Error("[storage:fs] invalid key: empty or too long");
  }
  if (key.includes("\0") || key.includes("\\")) {
    throw new Error(`[storage:fs] invalid key: ${JSON.stringify(key)}`);
  }
  if (key.startsWith("/")) {
    throw new Error(`[storage:fs] invalid key (absolute): ${JSON.stringify(key)}`);
  }
  const segments = key.split("/");
  for (const s of segments) {
    if (s === "" || s === "." || s === "..") {
      throw new Error(`[storage:fs] invalid key (path traversal): ${JSON.stringify(key)}`);
    }
  }
  // Windows 的磁碟代號（C:）在 path.resolve 會變成絕對路徑。
  if (/^[a-zA-Z]:/.test(segments[0])) {
    throw new Error(`[storage:fs] invalid key (drive letter): ${JSON.stringify(key)}`);
  }
  return segments;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 先寫暫存檔再 rename：rename 在同一個檔案系統上是原子的，讀的人不會讀到寫一半的檔案。 */
async function atomicWrite(target: string, data: Uint8Array | string) {
  const fsp = await import("node:fs/promises");
  const path = await import("node:path");
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, target);
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    throw e;
  }
}

function isNotFound(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function fsDriver(rootDir: string): StorageDriver {
  // 同一個 key 的寫入排隊執行：條件寫入是「讀 etag → 比對 → 寫」三步，不排隊的話
  // 兩個請求可能同時讀到舊 etag、都以為自己搶到了。只保護單一 process —— fs driver
  // 本來就是單機用的，多台機器共用一個目錄請改用 s3。
  const locks = new Map<string, Promise<unknown>>();
  function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const settled = run.catch(() => undefined);
    locks.set(key, settled);
    void settled.then(() => {
      if (locks.get(key) === settled) locks.delete(key);
    });
    return run;
  }

  async function paths(key: string) {
    const segments = normalizeStorageKey(key);
    const path = await import("node:path");
    const root = path.resolve(rootDir);
    const objectsRoot = path.join(root, "objects");
    const metaRoot = path.join(root, "meta");
    const file = path.resolve(objectsRoot, ...segments);
    const meta = path.resolve(metaRoot, ...segments) + ".json";
    // 第二道：就算 normalizeStorageKey 哪天被改壞，解析後的路徑也必須還在 root 底下。
    if (!file.startsWith(objectsRoot + path.sep) || !meta.startsWith(metaRoot + path.sep)) {
      throw new Error(`[storage:fs] key escapes storage dir: ${JSON.stringify(key)}`);
    }
    return { file, meta, path };
  }

  async function readMeta(metaPath: string): Promise<Meta | null> {
    const fsp = await import("node:fs/promises");
    try {
      return JSON.parse(await fsp.readFile(metaPath, "utf8")) as Meta;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  return {
    name: "fs",
    async put(key, body, { contentType, onlyIfEtag }) {
      const p = await paths(key);
      return withLock(p.file, async () => {
        if (onlyIfEtag) {
          const current = await readMeta(p.meta);
          if (current?.etag !== onlyIfEtag) return false;
        }
        const etag = await sha256Hex(body);
        await atomicWrite(p.file, body);
        await atomicWrite(p.meta, JSON.stringify({ contentType, etag } satisfies Meta));
        return true;
      });
    },
    async get(key) {
      const p = await paths(key);
      const meta = await readMeta(p.meta);
      if (!meta) return null;
      const fs = await import("node:fs");
      const fsp = await import("node:fs/promises");
      const { Readable } = await import("node:stream");
      try {
        await fsp.access(p.file);
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
      const body = Readable.toWeb(fs.createReadStream(p.file)) as unknown as ReadableStream<Uint8Array>;
      return { body, contentType: meta.contentType, etag: meta.etag };
    },
    async delete(key) {
      const p = await paths(key);
      const fsp = await import("node:fs/promises");
      await withLock(p.file, async () => {
        // force：不存在也不報錯，跟 R2 / S3 的語意一致。
        await fsp.rm(p.file, { force: true });
        await fsp.rm(p.meta, { force: true });
      });
    },
  };
}
