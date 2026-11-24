-- 0036: 站內 AI 助理（/dashboard/ai）的對話紀錄，以及操作紀錄的新來源 'ai'。
--
-- ai_conversations  一段對話。綁組織 + 使用者：只有本人看得到自己的對話（src/db/ai.ts 每個查詢
--                   都同時過濾 organization_id 與 user_id）。tool_groups 記這段對話已載入的工具組
--                   （src/lib/ai/tool-groups.ts），下一題接著用，不必每題重選。
-- ai_messages       OpenAI 相容格式的訊息：
--                   - role = 'user'       content 是使用者的問題
--                   - role = 'assistant'  content 是模型的文字，tool_calls 是它要呼叫的工具
--                                         （[{ id, name, arguments }]，arguments 是 JSON 字串）
--                   - role = 'tool'       一支工具呼叫的結果，tool_call_id 對回 assistant 的 tool_calls。
--                                         status：ok / error / pending（寫入工具等使用者按確認）/
--                                         cancelled（使用者按取消）。pending 的 content 為 NULL。
--                   input_tokens / output_tokens 只記在 assistant 列，用來估模型費用。
--
-- activity_log.channel 加 'ai'：站內 AI 代使用者做的寫入記成 channel = 'ai'，actor 是按下確認的那位成員
-- （src/db/activity.ts logAi）。程式碼比這支 migration 先上也安全 —— record() 會吞掉 CHECK 違規，
-- 只是少記那幾筆，寫入本身照常。
--
-- Forward-only，全部 additive。Run AFTER 0035。

CREATE TABLE ai_conversations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  tool_groups text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_conversations_owner ON ai_conversations (organization_id, user_id, updated_at DESC);

CREATE TABLE ai_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text,
  tool_calls jsonb,
  tool_call_id text,
  tool_name text,
  status text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ai_messages_role CHECK (role = ANY (ARRAY['user', 'assistant', 'tool'])),
  CONSTRAINT chk_ai_messages_status CHECK (
    status IS NULL OR status = ANY (ARRAY['ok', 'error', 'pending', 'cancelled'])
  )
);

CREATE INDEX idx_ai_messages_conversation ON ai_messages (conversation_id, id);

ALTER TABLE activity_log DROP CONSTRAINT chk_activity_channel;
ALTER TABLE activity_log
  ADD CONSTRAINT chk_activity_channel CHECK (channel = ANY (ARRAY['web', 'mcp', 'system', 'ai']));
