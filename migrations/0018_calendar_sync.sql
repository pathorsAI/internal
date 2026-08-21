-- 0018: Google 日曆同步。
--
-- 目的：請款/收款/開發票的日期排定後，要有人提醒。與其自己蓋一套通知系統，
-- 不如把事件寫進 Google 日曆 —— 提醒是 Google 自己發的（手機推播、email 都現成），
-- 所以本專案不需要任何 cron 或排程器。
--
-- 授權走 better-auth 的 generic-oauth plugin，provider id = 'google-calendar'，
-- 與登入用的 google social provider 分開：登入不該為了日曆而每次都跳同意畫面
-- （prompt 是 provider 層設定，無法單次覆寫）。token 存在既有的 account 表，
-- 這裡不重複存。Run AFTER 0017_billing_schedule.sql.

-- 每個組織一本專屬子日曆（不寫進成員的主日曆）：可整本開關、可分享給夥伴、
-- 誤刪也不影響個人行程。
CREATE TABLE calendar_settings (
  organization_id text PRIMARY KEY,
  google_calendar_id text,
  -- 用誰的授權推事件。該成員取消授權後同步會失敗，需重新連結。
  owner_user_id text REFERENCES "user"(id),
  reminder_days integer NOT NULL DEFAULT 3,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_calendar_reminder_days CHECK (reminder_days >= 0 AND reminder_days <= 60)
);

-- ERP 的一列 ↔ Google 事件的對應。有了它同步才是冪等的：改日期是 patch 同一個
-- 事件而不是再新增一顆；content_hash 讓內容沒變時直接跳過、不打 API。
CREATE TABLE calendar_event_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL,
  -- 對應 BillingRow.key：'bi:<id>' 或 'sub:<id>:<periodStart>'
  item_key text NOT NULL,
  -- 同一列可能有多顆事件（應請款日 / 收款期限 / 開發票）
  kind text NOT NULL,
  google_event_id text NOT NULL,
  content_hash text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_calendar_event_kind
    CHECK (kind = ANY (ARRAY['due'::text, 'payment'::text, 'invoice'::text]))
);
CREATE UNIQUE INDEX uq_calendar_event ON calendar_event_links (organization_id, item_key, kind);
CREATE INDEX idx_calendar_event_org ON calendar_event_links (organization_id);
