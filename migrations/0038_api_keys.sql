-- 0038: 組織層級的 API key（REST /api/v1 與 MCP 的 Bearer 金鑰），以及操作紀錄的新來源 'api'。
--
-- api_keys  一把金鑰。綁組織；以「建立者」的身分與目前的角色執行工具（src/lib/api-keys.ts），
--           建立者離開組織或權限下降，金鑰能做的事跟著縮小。
--           - key_hash：完整金鑰的 SHA-256（hex）。明文只在建立當下顯示一次，DB 不存。
--           - prefix：金鑰開頭幾個字（例如 pik_AbCd1234），只拿來在畫面上辨識是哪一把。
--           - scope：read = 只能呼叫 [read] 工具；write = 跟建立者在網頁上能做的一樣。
--           - expires_at NULL = 不過期；revoked_at 非 NULL = 已撤銷（保留列供操作紀錄對照）。
--           - last_used_at：最後一次驗證成功的時間（最多每分鐘更新一次）。
--
-- activity_log.channel 加 'api'：用 API key 呼叫的每一次 REST / MCP 工具都記一筆，
-- summary 開頭帶金鑰名稱。程式碼比這支 migration 先上也安全 —— record() 會吞掉 CHECK
-- 違規，只是少記那幾筆；但 api_keys 表不存在時金鑰驗證會失敗（一律回 401），所以要先跑這支。
--
-- Forward-only，全部 additive。Run AFTER 0037。

CREATE TABLE api_keys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  created_by_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT 'read',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  CONSTRAINT chk_api_keys_scope CHECK (scope = ANY (ARRAY['read', 'write'])),
  CONSTRAINT chk_api_keys_name CHECK (length(btrim(name)) BETWEEN 1 AND 100)
);

CREATE INDEX idx_api_keys_org ON api_keys (organization_id, created_at DESC);

ALTER TABLE activity_log DROP CONSTRAINT chk_activity_channel;
ALTER TABLE activity_log
  ADD CONSTRAINT chk_activity_channel CHECK (channel = ANY (ARRAY['web', 'mcp', 'system', 'ai', 'api']));
