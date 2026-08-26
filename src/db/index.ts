import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";
import * as authSchema from "./auth-schema";

// `schema.ts` is reflected from the DB via `bun run db:pull`; `auth-schema.ts` is
// hand-maintained for better-auth. Merge both so query helpers and the
// better-auth drizzle adapter share one client.
const fullSchema = { ...schema, ...authSchema };

type Db = ReturnType<typeof drizzle<typeof fullSchema>>;

let client: Db | null = null;

/** 真正建立連線用戶端。第一次要下查詢時才會走到這裡。 */
function connect(): Db {
  if (client) return client;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  client = drizzle(neon(connectionString), { schema: fullSchema });
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
