-- 0034: better-auth 的 rate limit 共用儲存（選用）。
--
-- 問題：better-auth 的 rateLimit.storage 預設是 memory。Cloudflare Workers 的 isolate
-- 短命又同時有很多份，計數不跨 isolate / colo 共享，限流只擋得住單機暴衝。
--
-- 做法：部署設 RATE_LIMIT_STORAGE=database 時，src/lib/auth.ts 會把 storage 換成
-- "database"，better-auth 改用 `rateLimit` model 讀寫這張表。欄位對照
-- @better-auth/core 的 db/get-tables（rateLimit：key unique / count / lastRequest bigint），
-- id 由 adapter 自己產生（text，跟其他 better-auth 表一樣）。drizzle 定義在
-- src/db/auth-schema.ts 的 rateLimit（export 名稱必須正好是 rateLimit）。
--
-- 沒設 RATE_LIMIT_STORAGE 時這張表不會被用到，先建起來也無害。
-- 每個 auth request 會多一次讀、一次寫（neon-http round trip），開之前評估延遲。
-- 表會隨 IP × 路徑累積列；better-auth 不清，需要時可定期刪掉 last_request 很舊的列
-- （last_request 是毫秒 epoch）。
--
-- Forward-only，全部 additive。Run AFTER 0033。

CREATE TABLE IF NOT EXISTS rate_limit (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);
