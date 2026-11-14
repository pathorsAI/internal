import { getCloudflareContext } from "@opennextjs/cloudflare";
import { neon } from "@neondatabase/serverless";
import type { BatchItem, BatchResponse } from "drizzle-orm/batch";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

// `schema.ts` is reflected from the DB via `bun run db:pull`; `auth-schema.ts` is
// hand-maintained for better-auth. Merge both so query helpers and the
// better-auth drizzle adapter share one client.
const fullSchema = { ...schema, ...authSchema };

/**
 * 兩種 driver 共同的型別：neon-http 的 NeonHttpDatabase 與 node-postgres 的
 * NodePgDatabase 都繼承 PgDatabase，查詢建構器（select / insert / update / query.*）
 * 完全一樣，呼叫端不需要知道底下是哪一個。
 *
 * 刻意不用其中一邊的具體型別：那會讓呼叫端不小心用到只有該 driver 才有的 API
 * （例如 neon-http 的 `batch`），換 driver 才在執行期爆掉。需要「一批原子寫入」
 * 請用下面的 runBatch。
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof fullSchema>;

export type DatabaseDriver = "neon-http" | "pg";

/** neon-http 的 Db 多一個 batch；只在 runBatch 內部辨識用，不對外。 */
type BatchCapableDb = Db & {
  batch<T extends Readonly<[BatchItem<"pg">, ...BatchItem<"pg">[]]>>(batch: T): Promise<BatchResponse<T>>;
};

/**
 * 決定用哪個 driver。
 *
 * - `DATABASE_DRIVER` 明講就照它（例如 Docker 裡連 Neon 卻想走 TCP，就設 `pg`）。
 * - 沒講就看主機名：`*.neon.tech` → neon-http，其餘一律 pg。這樣既有的 Neon 部署
 *   什麼都不用改，自架的人接一般 Postgres 也不用多設一個變數。
 */
export function resolveDriver(connectionString: string, driverEnv: string | undefined): DatabaseDriver {
  const explicit = driverEnv?.trim();
  if (explicit) {
    if (explicit === "neon-http" || explicit === "pg") return explicit;
    throw new Error(`DATABASE_DRIVER must be "neon-http" or "pg", got "${explicit}"`);
  }
  let hostname = "";
  try {
    hostname = new URL(connectionString).hostname;
  } catch {
    // 連線字串不是 URL 格式（例如 libpq 的 key=value）：交給 pg 自己解析。
  }
  return hostname.endsWith(".neon.tech") ? "neon-http" : "pg";
}

function poolMax(): number {
  const n = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function createClient(connectionString: string, driver: DatabaseDriver): Db {
  if (driver === "neon-http") {
    return drizzleNeonHttp(neon(connectionString), { schema: fullSchema });
  }
  return drizzleNodePg(new Pool({ connectionString, max: poolMax() }), { schema: fullSchema });
}

/** 連線字串對應的 Hyperdrive binding（Workers 上才會有）。 */
type HyperdriveBinding = { connectionString: string };

/**
 * 找 Cloudflare 的請求 context 與 Hyperdrive binding。不在 Workers / `next dev`
 * 裡時 getCloudflareContext 會丟錯（Docker、bun 腳本、測試都是這種情況），那就當成沒有。
 */
function hyperdriveContext(): { key: object; binding: HyperdriveBinding } | null {
  let ctx: ReturnType<typeof getCloudflareContext>;
  try {
    ctx = getCloudflareContext();
  } catch {
    return null;
  }
  const binding = (ctx.env as unknown as Record<string, unknown>).HYPERDRIVE;
  if (
    binding &&
    typeof binding === "object" &&
    typeof (binding as Partial<HyperdriveBinding>).connectionString === "string"
  ) {
    return { key: ctx, binding: binding as HyperdriveBinding };
  }
  return null;
}

/**
 * Hyperdrive 的用戶端以「請求」為單位快取。
 *
 * 為什麼不能像其他路徑一樣存在 module scope：Workers 不允許跨請求共用 I/O 物件，
 * 上一個請求開的 TCP socket 在下一個請求裡用會直接丟錯。Cloudflare 的 Hyperdrive
 * 文件因此要求每個請求自己建 client —— 真正昂貴的連線池在 Hyperdrive 那一端，
 * Worker 這端建 client 很便宜。
 *
 * OpenNext 每個請求都會給一個新的 context 物件（AsyncLocalStorage 的 store），
 * 拿它當 WeakMap 的 key，同一個請求內共用、請求結束就跟著被回收。
 * Pool 的 max 設 5：Workers 每次呼叫同時最多 6 條對外連線，留一條給 fetch 等其他 I/O。
 * 不主動 end()：請求結束時 runtime 會關掉這次請求開的 socket。
 */
const perRequestClients = new WeakMap<object, Db>();

let client: Db | null = null;

/** 真正建立連線用戶端。第一次要下查詢時才會走到這裡。 */
function connect(): Db {
  if (client) return client;

  const hyperdrive = hyperdriveContext();
  if (hyperdrive) {
    let perRequest = perRequestClients.get(hyperdrive.key);
    if (!perRequest) {
      perRequest = drizzleNodePg(new Pool({ connectionString: hyperdrive.binding.connectionString, max: 5 }), {
        schema: fullSchema,
      });
      perRequestClients.set(hyperdrive.key, perRequest);
    }
    return perRequest;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  client = createClient(connectionString, resolveDriver(connectionString, process.env.DATABASE_DRIVER));
  return client;
}

/**
 * 惰性代理：拿到它不算連線，第一次**存取屬性**（也就是真的要查詢）才會建立用戶端。
 *
 * 為什麼要多這一層，而不是讓 getDb() 直接回傳建好的用戶端：`next build` 的
 * 「Collecting page data」階段會 import 每一個 route module，連帶執行它們
 * module scope 的程式碼。src/lib/auth.ts 的 `drizzleAdapter(getDb(), …)` 就在
 * module scope，所以只要 getDb() 會在當下就讀 DATABASE_URL，**build 就會需要一組
 * 資料庫憑證**，即使建置過程從頭到尾不會連線。那會逼得 CI／Cloudflare Workers
 * Builds 得設一個假的 DATABASE_URL 才建得起來 —— 用設定去補程式的設計問題。
 *
 * 代理讓「持有 db 參考」與「使用 db」分離：better-auth 的 drizzle adapter 只在
 * closure 裡用到 db（工廠函式本體完全沒碰），所以建置期永遠不會觸發 connect()。
 * 同一個代理也讓 Hyperdrive 的「每個請求一個 client」對呼叫端透明：每次存取都
 * 重新經過 connect()，自然拿到當下這個請求的 client。
 *
 * 方法要 bind 回真正的用戶端，否則 drizzle 內部的 `this` 會指到代理，
 * 每次呼叫又繞回 get trap。
 */
const lazyDb = new Proxy({} as Db, {
  get(_target, prop) {
    const db = connect();
    const value = db[prop as keyof Db];
    return typeof value === "function" ? value.bind(db) : value;
  },
  has(_target, prop) {
    return prop in connect();
  },
});

/**
 * 這個應用程式取得資料庫用戶端的唯一入口。
 *
 * 回傳的東西可以自由地在 module scope 持有、傳遞、存進設定物件；只有真的下查詢
 * 時才需要 DATABASE_URL。**請維持這個性質** —— 一旦有人在 module scope 主動觸發
 * 查詢，建置就會再次需要資料庫憑證。
 */
export function getDb(): Db {
  return lazyDb;
}

type BatchQueries = Readonly<[BatchItem<"pg">, ...BatchItem<"pg">[]]>;

/**
 * 一批要「全部成功或全部不算」的寫入，兩種 driver 都能用。
 *
 * - neon-http：用 `db.batch`，Neon 會把整批包在同一個交易裡送出（一次 HTTP 來回）。
 * - pg：開 `db.transaction`，依序執行，任何一句丟錯就整批 rollback。
 *
 * 為什麼要傳「建構函式」而不是建好的查詢：pg 的交易綁在某一條連線上，查詢必須
 * 用交易物件 `tx` 建才會跑在那條連線裡；用外面的 db 建好的查詢會從連線池另拿一條，
 * 等於沒有交易。所以由這裡決定 `q` 是 db 還是 tx，呼叫端一律用 `q` 組查詢。
 *
 * 回傳的 tuple 形狀與 `db.batch` 相同：第 i 個元素是第 i 句的結果。
 * 判斷依據是 db 身上有沒有 `batch`，不看環境變數，所以測試注入的 db 也照樣適用。
 */
function canBatch(db: Db): db is BatchCapableDb {
  return typeof (db as Partial<BatchCapableDb>).batch === "function";
}

export async function runBatch<T extends BatchQueries>(
  build: (q: Db) => T,
  db: Db = getDb(),
): Promise<BatchResponse<T>> {
  if (canBatch(db)) {
    return db.batch(build(db));
  }
  return db.transaction(async (tx) => {
    const results: unknown[] = [];
    // 刻意逐句 await：同一條連線上的交易本來就只能一句一句跑，Promise.all 也不會比較快。
    for (const query of build(tx as unknown as Db)) {
      results.push(await query);
    }
    return results as BatchResponse<T>;
  });
}
