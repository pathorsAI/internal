-- 0047: 功能使用紀錄（docs/usage-tracking.md）。
--
-- 記「誰在用哪個功能」，給 設定 › 功能使用狀況 看哪些頁面、哪些工具沒人用：
--   kind = 'page'  dashboard 的一次頁面載入；feature 是正規化的路由 pattern（例如 /dashboard/ai/[id]），
--                  不含 query string、不含頁面內容。同一人同一頁 30 秒內只記一次。
--   kind = 'tool'  MCP／REST API／站內 AI／聊天 bot 的一次工具呼叫（讀取也算）；feature 是工具名稱，
--                  ok = 成功或失敗，duration_ms = 耗時。不記參數、不記回傳內容。
--
-- 刻意跟 activity_log 分開：activity_log 是稽核用的寫入紀錄（誰改了哪一筆），永久保存；
-- 這張是用量統計，量大、只保留 180 天（每日 cron 清理），不該把稽核紀錄淹沒。
--
-- organization_id 可為 NULL：還沒選組織前呼叫的工具（list_organizations、list_my_invitations）。
-- 統計時依使用者的組織成員資格歸到他所屬的組織。
-- 不設 FK（跟 activity_log 一樣）：紀錄寫入失敗或對象被刪都不該連動，舊資料由保存期限清掉。
--
-- 自架者可以設 USAGE_TRACKING=off 關掉寫入（這張表仍會建立，只是不會有資料）。
--
-- Forward-only，全部 additive。Run AFTER 0046_current_org.sql。

CREATE TABLE usage_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text,
  user_id text,
  kind text NOT NULL,
  channel text NOT NULL,
  feature text NOT NULL,
  ok boolean,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_usage_kind CHECK (kind = ANY (ARRAY['page', 'tool'])),
  CONSTRAINT chk_usage_channel CHECK (channel = ANY (ARRAY['web', 'mcp', 'api', 'ai', 'line', 'whatsapp'])),
  CONSTRAINT chk_usage_feature_len CHECK (char_length(feature) <= 200)
);

-- 使用狀況頁：某組織近 N 天的紀錄。
CREATE INDEX idx_usage_org_time ON usage_events (organization_id, created_at DESC);
-- 沒有組織的那幾筆，依使用者歸戶。
CREATE INDEX idx_usage_user_time ON usage_events (user_id, created_at DESC);
-- 每日清理（DELETE … WHERE created_at < now() - 180 days）。
CREATE INDEX idx_usage_time ON usage_events (created_at);
