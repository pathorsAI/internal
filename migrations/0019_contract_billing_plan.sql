-- 0019: 合約即排程（請款方式）+ 發票的外部（Simpany）開立狀態。
--
-- 0017 建好了 billing_items，但「一張合約分三期」仍要人一期一期手打，合約與排程
-- 之間沒有任何推導關係。本 migration 把「這張合約要怎麼請款」變成合約自己的屬性，
-- 存檔即可展開成 billing_items —— 排程仍然是實體列（人會逐筆改金額、改日期、改
-- 名稱），計畫只是產生器，不是唯一真相。因此展開後改動 billing_items 不會被計畫
-- 蓋掉，除非使用者明確要求「重新產生」。
--
-- 另一半是發票：Simpany 是發票的真相來源，本系統不假裝能開票，只負責回答
-- 「該開什麼」與「開了沒」，差異用對帳呈現。
-- Forward-only，全部 additive。Run AFTER 0018_calendar_sync.sql.

-- (1) 合約的請款計畫
-- single       一次付清
-- installments 分 N 期
-- milestones   里程碑（金額與日期逐筆自訂，不由計畫推導）
-- subscription 月費（改由 subscriptions 表管理週期，合約本身不展開排程）
-- NULL         舊合約 / 未設定，維持現狀不展開
ALTER TABLE contracts ADD COLUMN billing_plan text;
ALTER TABLE contracts ADD CONSTRAINT chk_contract_billing_plan
  CHECK (billing_plan IS NULL OR billing_plan = ANY (ARRAY['single'::text, 'installments'::text, 'milestones'::text, 'subscription'::text]));

-- 分 N 期的期數（billing_plan = 'installments' 時有意義）
ALTER TABLE contracts ADD COLUMN installment_count integer;
ALTER TABLE contracts ADD CONSTRAINT chk_contract_installment_count
  CHECK (installment_count IS NULL OR (installment_count >= 1 AND installment_count <= 60));

-- 各期比例，逗號分隔的百分比，例如 '30,40,30'。NULL = 平均分攤。
-- 存字串而不是子表：這只是「產生排程用的參數」，展開後真相在 billing_items，
-- 開一張子表會製造第二份分期定義。
ALTER TABLE contracts ADD COLUMN installment_split text;

-- 期與期相隔幾個月（分期常見一個月一期；里程碑不適用）
ALTER TABLE contracts ADD COLUMN billing_interval_months integer NOT NULL DEFAULT 1;
ALTER TABLE contracts ADD CONSTRAINT chk_contract_billing_interval
  CHECK (billing_interval_months >= 1 AND billing_interval_months <= 12);

-- 應請款日怎麼算：
-- signed_date         基準日（簽約日，無則 start_date）起，每隔 interval 個月當天
-- day_of_month        每月第 N 個日曆日（超過該月天數則取月底）
-- business_day_of_month 每月第 N 個工作日（週一～週五；不含國定假日，見 lib 註解）
ALTER TABLE contracts ADD COLUMN due_rule text NOT NULL DEFAULT 'signed_date';
ALTER TABLE contracts ADD CONSTRAINT chk_contract_due_rule
  CHECK (due_rule = ANY (ARRAY['signed_date'::text, 'day_of_month'::text, 'business_day_of_month'::text]));

-- day_of_month / business_day_of_month 的 N
ALTER TABLE contracts ADD COLUMN due_day integer;
ALTER TABLE contracts ADD CONSTRAINT chk_contract_due_day
  CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31));

COMMENT ON COLUMN contracts.billing_plan IS '請款方式：single / installments / milestones / subscription；NULL = 未設定（不展開排程）';
COMMENT ON COLUMN contracts.installment_split IS '各期百分比，逗號分隔（例 30,40,30）；NULL = 平均分攤';
COMMENT ON COLUMN contracts.due_rule IS '應請款日算法：signed_date / day_of_month / business_day_of_month';
COMMENT ON COLUMN contracts.due_day IS 'day_of_month 為第幾個日曆日；business_day_of_month 為第幾個工作日';

-- (2) 發票的外部（Simpany）開立狀態
-- pending  本系統認為該開，Simpany 還沒開
-- issued   Simpany 已開，external_ref 記其發票號碼
-- void     Simpany 端已作廢
-- n_a      不需要在 Simpany 開（例如廠商開給我們的進項發票）
ALTER TABLE invoices ADD COLUMN external_status text NOT NULL DEFAULT 'pending';
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_external_status
  CHECK (external_status = ANY (ARRAY['pending'::text, 'issued'::text, 'void'::text, 'n_a'::text]));

-- Simpany 端的單號 / 發票號碼，對帳時的比對鍵
ALTER TABLE invoices ADD COLUMN external_ref text;

-- 既有資料回填。進項發票不經 Simpany 開立，一律標成不適用。
UPDATE invoices SET external_status = 'n_a' WHERE direction = 'received';

-- 銷項已經填了發票號碼的，視為 Simpany 已開，號碼即為對帳鍵；其餘維持預設的
-- 「待開立」。nullif(btrim(...)) 把空字串與純空白一併正規化成 NULL，所以只需要
-- 一次 IS NOT NULL 判斷，不必再對空字串另外比較。
UPDATE invoices
   SET external_status = 'issued',
       external_ref = nullif(btrim(invoice_number), '')
 WHERE direction <> 'received'
   AND nullif(btrim(invoice_number), '') IS NOT NULL;

CREATE INDEX idx_invoice_external_status ON invoices (organization_id, external_status) WHERE deleted_at IS NULL;

COMMENT ON COLUMN invoices.external_status IS 'Simpany 端的開立狀態：pending / issued / void / n_a';
COMMENT ON COLUMN invoices.external_ref IS 'Simpany 單號（對帳比對鍵）';
