-- 0023: 組織層級的外部整合（Simpany 電子發票、Wise …）。
--
-- 目的：接外部服務要存「這個組織的帳密 / token」與「這個整合開了沒」。與其每接一家
-- 就開一張 xxx_settings 表（像 0018 的 calendar_settings），不如一張通用表，一列 =
-- 一個組織的一個整合，框架（src/lib/integrations）統一處理連接、開關、加密、失效。
--
-- 規則：
-- - 預設關閉：owner / admin 先「連接」（輸入憑證，server 端實測通過才寫入），寫入時
--   enabled = false，要另外手動打開。這樣「接上了」與「開始會對外動作」是兩個決定。
-- - 憑證一律密文：credentials_enc / token_cache_enc 是 src/lib/crypto.ts 的
--   encryptJson / encryptField 輸出（`v1:<iv>:<ct>`，金鑰 FIELD_ENCRYPTION_KEY），
--   絕不存明文，也絕不回傳給 client 或 MCP。
-- - 中斷連接 = 刪列（不軟刪）：留著密文沒有意義，重新連接就是重新輸入。
-- - Google 日曆不搬進來：它的 token 在 better-auth 的 account 表，設定在
--   calendar_settings，維持原狀；UI 只是把它列在同一個整合清單裡。
--
-- provider 的 CHECK 清單就是「系統認得的整合」，新增一家要改這裡（新 migration）
-- 並在 src/lib/integrations/catalog.ts 補一筆。
-- Forward-only，全部 additive。Run AFTER 0022_subscription_contract.sql.

CREATE TABLE org_integrations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  -- connected    憑證有效，可以使用（enabled 另計）
  -- needs_reauth 外部服務拒絕了憑證（密碼改了、token 被撤銷），要重新連接
  -- error        其他持續性錯誤（外部服務異常等），細節在 last_error
  status text NOT NULL DEFAULT 'connected',
  -- 非機密設定：例如 Simpany 的公司 id、Wise 的 profile id / 帳戶對應。可直接顯示。
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- encryptJson(憑證物件)。欄位名與內容由各 provider 的 credentialFields 決定。
  credentials_enc text,
  -- provider 自己換來的 session token（例如登入後拿到的 cookie / bearer），也要加密。
  token_cache_enc text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  connected_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_org_integration UNIQUE (organization_id, provider),
  CONSTRAINT chk_org_integration_provider
    CHECK (provider = ANY (ARRAY['simpany'::text, 'wise'::text])),
  CONSTRAINT chk_org_integration_status
    CHECK (status = ANY (ARRAY['connected'::text, 'needs_reauth'::text, 'error'::text]))
  -- enabled 與 status 刻意不綁 CHECK：憑證失效（needs_reauth）時保留使用者的開關意圖，
  -- 重新連接後自動恢復原狀。「能不能用」由程式判斷 enabled AND status = 'connected'。
);

COMMENT ON TABLE org_integrations IS '組織層級外部整合（一列 = 一個組織的一個 provider）；中斷連接即刪列';
COMMENT ON COLUMN org_integrations.provider IS '整合代號：simpany / wise；對應 src/lib/integrations/catalog.ts';
COMMENT ON COLUMN org_integrations.enabled IS '是否開啟；連接後預設 false，需 owner/admin 手動開啟；實際可用 = enabled AND status = connected';
COMMENT ON COLUMN org_integrations.status IS 'connected / needs_reauth（憑證被拒，需重新連接）/ error（其他持續性錯誤）';
COMMENT ON COLUMN org_integrations.config IS '非機密設定（公司 id、帳戶對應等），可顯示給成員與 MCP';
COMMENT ON COLUMN org_integrations.credentials_enc IS 'encryptJson(憑證) 密文（FIELD_ENCRYPTION_KEY）；絕不存明文、絕不回傳';
COMMENT ON COLUMN org_integrations.token_cache_enc IS 'provider 快取的 session token 密文；過期或失效可隨時丟棄重換';
COMMENT ON COLUMN org_integrations.token_expires_at IS 'token_cache_enc 的到期時間';
COMMENT ON COLUMN org_integrations.last_synced_at IS '最近一次成功呼叫外部服務的時間';
COMMENT ON COLUMN org_integrations.last_error IS '最近一次失敗的訊息（給人看，不含憑證）';
