-- 0017: 請款排程（請款日 / 收款日 / 開發票日 / 簽約日）。
--
-- 問題：每個客戶的簽約日、請款日、收款日、開發票日、合約週期都不一樣，但系統只
-- 有 contracts.start_date / end_date，無法表達「這張合約分三期請款、每期各自有應
-- 請款日」，也無從得知「請款了沒 / 發票開了沒」。訂閱（subscriptions）雖已有週期
-- 引擎，卻同樣只知道收了多少，不知道什麼時候請的款。
--
-- 命名說明：0010_drop_receivables 建議日後以 `contract_payments`（contracts 的子表）
-- 重新引入日期化的應收。本表遵守該精神——掛在 contract / project 底下，不另開一本
-- 平行的應收帳款帳本——但因為還要涵蓋「專案里程碑請款」與「無合約的臨時請款」，
-- 故命名為 billing_items。
--
-- 訂閱期別刻意「不」寫進本表：期別是由 start_date + interval_months 即時算出來的
-- （src/db/queries.ts 的 computeSubscriptionSchedule），物化會產生兩份狀態必然漂移。
-- 訂閱缺的只是「實際請款日 / 開發票日」，因此加在既有的 subscription_periods 上。
-- 看板在 query 層把兩個來源合併。Forward-only，全部 additive。
-- Run AFTER 0016_activity_read_action.sql.

-- (1) 合約補簽約日與付款條件
ALTER TABLE contracts ADD COLUMN signed_date date;
-- 請款後幾天應收到款（月結 30 天 → 30）；NULL 表示未約定，逾期以 due_date 判斷
ALTER TABLE contracts ADD COLUMN payment_terms_days integer;

-- (2) 請款項目：一次性合約分期 / 專案里程碑 / 臨時請款
CREATE TABLE billing_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text,
  customer_party_id bigint NOT NULL REFERENCES parties(id),
  contract_id bigint REFERENCES contracts(id),
  project_id bigint REFERENCES projects(id),
  title text NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'TWD',
  due_date date,
  billed_on date,
  paid_on date,
  invoiced_on date,
  needs_invoice boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'scheduled',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_billing_item_status
    CHECK (status = ANY (ARRAY['scheduled'::text, 'billed'::text, 'paid'::text, 'cancelled'::text]))
);
COMMENT ON COLUMN billing_items.due_date IS '應請款日';
COMMENT ON COLUMN billing_items.billed_on IS '實際請款日';
COMMENT ON COLUMN billing_items.paid_on IS '收款日（人工註記；實收金額一律以綁定的 transactions 為準）';
COMMENT ON COLUMN billing_items.invoiced_on IS '開發票日';

CREATE INDEX idx_billing_item_org_due ON billing_items (organization_id, due_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_billing_item_contract ON billing_items (contract_id);
CREATE INDEX idx_billing_item_project ON billing_items (project_id);
CREATE INDEX idx_billing_item_customer ON billing_items (customer_party_id);

-- (3) 訂閱每期補「實際動作」欄位（沿用既有的每期覆寫表，不另開表）。
-- 原本 subscription_periods 只在「該期應收金額要覆寫」時才有列；加上這些欄位後，
-- 只記錄請款/開發票也會建列，故 expected_amount 需可為 NULL（NULL = 退回 subscriptions.amount）。
ALTER TABLE subscription_periods ADD COLUMN due_date date;
ALTER TABLE subscription_periods ADD COLUMN billed_on date;
ALTER TABLE subscription_periods ADD COLUMN invoiced_on date;
ALTER TABLE subscription_periods ALTER COLUMN expected_amount DROP NOT NULL;

-- (4) 交易綁定請款項目，讓「已收多少」自動算（比照 0009 的合約綁定）
ALTER TABLE transactions ADD COLUMN billing_item_id bigint REFERENCES billing_items(id);
CREATE INDEX idx_txn_billing_item ON transactions (billing_item_id);

-- (5) 發票補外鍵。原本只有 counterparty_name 純文字，無法回答「這張發票是哪個客戶、
-- 對應哪一筆請款」。維持 counterparty_name 不動（歷史資料與手key仍可用）。
ALTER TABLE invoices ADD COLUMN party_id bigint REFERENCES parties(id);
ALTER TABLE invoices ADD COLUMN contract_id bigint REFERENCES contracts(id);
ALTER TABLE invoices ADD COLUMN billing_item_id bigint REFERENCES billing_items(id);
CREATE INDEX idx_invoice_party ON invoices (party_id);
CREATE INDEX idx_invoice_billing_item ON invoices (billing_item_id);
