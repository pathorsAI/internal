-- 0032: 固定支出（recurring_expenses）+ Discord 通知。
--
-- 目的：Core team 要在 Discord 頻道裡 (a) 每個月各家廠商（GCP、Neon、LiveKit、Anthropic…）
-- 扣款前幾天收到提醒：哪一筆、會用哪個付款方式（哪張卡）扣、最後從哪個帳戶出；(b) 每月固定一天收到上個月固定支出的
-- 回顧，依「實際付款的帳戶 / 卡」分組，並標出異常（該扣沒扣、扣錯帳戶、代墊還沒報帳）。
--
-- 帳本（transactions）本來就有實際付款的資料（from_account_id、party、description、type、
-- settle_employee_id），缺的是「這家廠商預期每月幾號、用哪個付款方式扣」—— 就是 recurring_expenses。
-- 卡的身分（卡別、末四碼、最後從哪個帳本帳戶扣）放在 0031 的 payment_methods，這裡只參照它；
-- 跨表參照的同組織驗證在應用層（src/lib/vendor-billing/guards.ts）。
-- 交易不綁 recurring_expense_id：Wise 每天自動匯入幾十筆，不可能人工一筆一筆綁。改成以
-- match_pattern 比對交易的對象名稱或說明（src/lib/recurring-expenses.ts 的 matchesExpense）。
--
-- 通知從每日 cron（台北 06:00，src/lib/billing-notify.ts）送出。cron 可能重跑、手動觸發也會跑同一條
-- 程式碼，所以每則通知先在 notification_deliveries 搶一個 (org, channel, dedupe_key)，搶到才送；
-- 送失敗就刪掉那列，下一輪再試。
--
-- Forward-only，全部 additive（新表、放寬 chk_org_integration_provider）。
-- Run AFTER 0031（參照 payment_methods，並沿用 0031 的 provider 清單再加上 discord）。

CREATE TABLE recurring_expenses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  -- 廠商（選填）：只用來顯示與預填；比對交易靠 match_pattern。
  party_id bigint REFERENCES parties(id),
  -- 以 | 分隔、不分大小寫的子字串，比對交易的對象名稱或說明，例如 'google*cloud|gcp'。
  -- NULL = 用 name 比對。
  match_pattern text,
  -- 預期的付款方式（選填）。預期扣款的帳本帳戶 = payment_methods.settles_from_account_id；
  -- 回顧時實際付款帳戶跟它不同就標「扣款帳戶跟設定不同」。
  payment_method_id bigint REFERENCES payment_methods(id) ON DELETE SET NULL,
  -- fixed：固定日期扣款（每 interval_months 個月，從 anchor_date 起算）
  -- usage：用量計費 / 自動儲值，沒有固定扣款日（例如 OpenAI 自動儲值）—— 不提醒、不檢查漏扣
  schedule text NOT NULL,
  -- 任一次扣款日（過去或未來都可以）。日期大於當月天數時壓到月底（1/31 → 2/28）。
  anchor_date date,
  interval_months integer NOT NULL DEFAULT 1,
  expected_amount numeric(18,2),
  currency char(3),
  -- 廠商帳單頁，提醒訊息裡附連結
  billing_url text,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT chk_recurring_expense_schedule CHECK (schedule = ANY (ARRAY['fixed'::text, 'usage'::text])),
  CONSTRAINT chk_recurring_expense_anchor CHECK (schedule = 'usage' OR anchor_date IS NOT NULL),
  CONSTRAINT chk_recurring_expense_interval CHECK (interval_months BETWEEN 1 AND 36)
);

CREATE INDEX idx_recurring_expense_org ON recurring_expenses (organization_id);

COMMENT ON TABLE recurring_expenses IS '固定支出：公司定期付給廠商的費用；Discord 扣款提醒與每月回顧的來源';
COMMENT ON COLUMN recurring_expenses.match_pattern IS '以 | 分隔、不分大小寫的子字串，比對交易的對象名稱或說明；NULL = 用 name';
COMMENT ON COLUMN recurring_expenses.payment_method_id IS '預期的付款方式（同組織）；預期扣款帳戶 = 它的 settles_from_account_id，回顧時與實際付款帳戶不同會標出';
COMMENT ON COLUMN recurring_expenses.schedule IS 'fixed = 固定日期扣款（anchor_date + interval_months）；usage = 用量 / 自動儲值，沒有固定日';
COMMENT ON COLUMN recurring_expenses.anchor_date IS '任一次扣款日；之後每 interval_months 個月一次，日期壓到月底';

-- 對外通知的冪等紀錄：先搶到這一列才送，送失敗就刪掉讓下一輪重試。
CREATE TABLE notification_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  channel text NOT NULL,
  -- reminder:<recurringExpenseId>:<chargeDate>、recap:<YYYY-MM>
  dedupe_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_delivery UNIQUE (organization_id, channel, dedupe_key)
);

COMMENT ON TABLE notification_deliveries IS '對外通知（Discord）的冪等紀錄：(org, channel, dedupe_key) 唯一，搶到才送';
COMMENT ON COLUMN notification_deliveries.dedupe_key IS 'reminder:<recurringExpenseId>:<chargeDate> 或 recap:<YYYY-MM>';

-- 整合清單加上 discord（0023 的 CHECK，0031 加過 azure / gcp）。
ALTER TABLE org_integrations DROP CONSTRAINT chk_org_integration_provider;
ALTER TABLE org_integrations
  ADD CONSTRAINT chk_org_integration_provider
    CHECK (provider = ANY (ARRAY['simpany'::text, 'wise'::text, 'azure'::text, 'gcp'::text, 'discord'::text]));
COMMENT ON COLUMN org_integrations.provider IS '整合代號：simpany / wise / azure / gcp / discord；對應 src/lib/integrations/catalog.ts';
