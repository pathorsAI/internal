-- 0042: LINE／WhatsApp bot（站內 AI 的聊天入口）與 AI 規則。
--
-- chat_identities     一個聊天平台帳號 ↔ 一位 internal 使用者。每個平台每人只能綁一個帳號、
--                     每個平台帳號只能綁一個人。active_org_id 是 bot 目前替這個人操作的組織
--                     （「切換組織」改它；組織被刪就變 NULL，bot 會請他重選）。
--                     busy_until 是「同一人同時只跑一題」的鎖：UPDATE … WHERE busy_until IS NULL
--                     OR busy_until < now() 搶到才跑，跑完放掉；程式掛掉也會在時間到後自動失效。
-- chat_link_codes     網頁產生的 6 位數綁定碼，只存 sha256(code)。10 分鐘過期、用一次就標 used_at。
--                     org_id 是產生時所在的組織，綁定後當 active_org_id。
-- chat_inbound_events webhook 去重（平台會重送）。保留 7 天，每日 cron 清。
-- chat_cards          送到聊天裡的確認卡。按鈕 payload 只帶 c:<id>:<action>，其他都查這張表：
--                     tool_call_ids 對回 ai_messages 的 pending 工具結果。24 小時過期。
-- chat_buffer         訊息暫存：幾則訊息（文字＋照片）安靜幾秒後才合成一題送給 AI。
-- chat_message_refs   平台訊息 id ↔ 我們的對話／訊息／檔案／確認卡，用來解析「回覆（引用）某一則」。
--                     進來與送出的訊息都記。保留 90 天。
-- ai_rules            使用者教 AI 的規則（「以後 Google Workspace 都歸軟體工具」）。scope = org 全組織
--                     套用（只有 owner/admin 能建）、scope = user 只套在本人。match / action 是 jsonb，
--                     比對邏輯在 src/lib/ai/rules.ts。軟刪（deleted_at）。
--
-- 既有表：
-- ai_conversations.channel   web | line | whatsapp，對話列表標平台。
-- ai_messages.attachments    user 訊息附的檔案 [{ documentId, fileName, contentType }]。
-- documents.uploaded_by / source  誰、從哪個入口上傳。聊天收到的檔案先建一列 transaction_id／
--                                 invoice_id 都 NULL 的 document（收件匣），按確認時才掛上交易。
-- activity_log.channel       加 'line'、'whatsapp'。程式碼比 migration 先上也安全：record() 會吞掉
--                            CHECK 違規，只是少記那幾筆。
--
-- Forward-only，全部 additive。Run AFTER 0041.

CREATE TABLE chat_identities (
  id text PRIMARY KEY,
  provider text NOT NULL,
  external_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  active_org_id text REFERENCES "organization"(id) ON DELETE SET NULL,
  display_name text,
  busy_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_chat_identities_provider CHECK (provider = ANY (ARRAY['line', 'whatsapp'])),
  CONSTRAINT uq_chat_identities_external UNIQUE (provider, external_id),
  CONSTRAINT uq_chat_identities_user UNIQUE (provider, user_id)
);

CREATE TABLE chat_link_codes (
  code_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT chk_chat_link_codes_provider CHECK (provider = ANY (ARRAY['line', 'whatsapp']))
);

CREATE INDEX idx_chat_link_codes_user ON chat_link_codes (user_id, provider);

CREATE TABLE chat_inbound_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX idx_chat_inbound_events_received ON chat_inbound_events (received_at);

CREATE TABLE chat_cards (
  id text PRIMARY KEY,
  identity_id text NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  tool_call_ids text[] NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT chk_chat_cards_status CHECK (status = ANY (ARRAY['open', 'done', 'expired']))
);

CREATE INDEX idx_chat_cards_open ON chat_cards (identity_id, status, expires_at);

CREATE TABLE chat_buffer (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_id text NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_message_id text,
  kind text NOT NULL,
  text text,
  document_id bigint REFERENCES documents(id) ON DELETE SET NULL,
  quoted_external_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CONSTRAINT chk_chat_buffer_provider CHECK (provider = ANY (ARRAY['line', 'whatsapp'])),
  CONSTRAINT chk_chat_buffer_kind CHECK (kind = ANY (ARRAY['text', 'media', 'button']))
);

CREATE INDEX idx_chat_buffer_pending ON chat_buffer (identity_id, received_at) WHERE consumed_at IS NULL;

CREATE TABLE chat_message_refs (
  provider text NOT NULL,
  external_message_id text NOT NULL,
  identity_id text NOT NULL REFERENCES chat_identities(id) ON DELETE CASCADE,
  conversation_id text REFERENCES ai_conversations(id) ON DELETE SET NULL,
  direction text NOT NULL,
  ai_message_id bigint REFERENCES ai_messages(id) ON DELETE SET NULL,
  document_id bigint REFERENCES documents(id) ON DELETE SET NULL,
  card_id text REFERENCES chat_cards(id) ON DELETE SET NULL,
  snippet text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_message_id),
  CONSTRAINT chk_chat_message_refs_provider CHECK (provider = ANY (ARRAY['line', 'whatsapp'])),
  CONSTRAINT chk_chat_message_refs_direction CHECK (direction = ANY (ARRAY['in', 'out']))
);

CREATE INDEX idx_chat_message_refs_created ON chat_message_refs (created_at);

CREATE TABLE ai_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  scope text NOT NULL,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL,
  match jsonb NOT NULL DEFAULT '{}'::jsonb,
  action jsonb NOT NULL DEFAULT '{}'::jsonb,
  text text NOT NULL,
  created_by text REFERENCES "user"(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'web',
  apply_count integer NOT NULL DEFAULT 0,
  last_applied_at timestamptz,
  disabled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ai_rules_scope CHECK (scope = ANY (ARRAY['org', 'user'])),
  CONSTRAINT chk_ai_rules_scope_user CHECK (scope = 'org' OR user_id IS NOT NULL),
  CONSTRAINT chk_ai_rules_kind CHECK (kind = ANY (ARRAY['category', 'advance_default', 'note'])),
  CONSTRAINT chk_ai_rules_source CHECK (source = ANY (ARRAY['web', 'line', 'whatsapp', 'mcp']))
);

CREATE INDEX idx_ai_rules_org ON ai_rules (organization_id) WHERE deleted_at IS NULL;

ALTER TABLE ai_conversations ADD COLUMN channel text NOT NULL DEFAULT 'web';
ALTER TABLE ai_conversations
  ADD CONSTRAINT chk_ai_conversations_channel CHECK (channel = ANY (ARRAY['web', 'line', 'whatsapp']));

ALTER TABLE ai_messages ADD COLUMN attachments jsonb;

ALTER TABLE documents ADD COLUMN uploaded_by text REFERENCES "user"(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN source text;
ALTER TABLE documents
  ADD CONSTRAINT chk_doc_source CHECK (source IS NULL OR source = ANY (ARRAY['web', 'line', 'whatsapp', 'mcp']));
-- 收件匣（還沒掛上交易或發票的聊天檔案）：cron 清 30 天前的、工具掛附件時查。
CREATE INDEX idx_doc_inbox ON documents (organization_id, uploaded_at)
  WHERE transaction_id IS NULL AND invoice_id IS NULL AND deleted_at IS NULL;

ALTER TABLE activity_log DROP CONSTRAINT chk_activity_channel;
ALTER TABLE activity_log
  ADD CONSTRAINT chk_activity_channel CHECK (
    channel = ANY (ARRAY['web', 'mcp', 'system', 'ai', 'api', 'line', 'whatsapp'])
  );
