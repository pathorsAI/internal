-- 0039: 資料聯動（docs/data-links.md）。
--
-- 1. transactions 加「待連結」：
--    - review_reason     為什麼要人看（跟 needs_review 分開：needs_review 是「分類還沒確認」，
--                        指定分類就會清掉；review_reason 是「這筆錢屬於誰還沒定」，要在待連結頁
--                        選候選或略過才會清掉）。
--      link_suggested        剛好一個金額相符的候選，但這筆是重新掃描的舊交易，等人確認
--      link_ambiguous        有多個金額相符的候選
--      link_amount_mismatch  有候選，但金額都對不上
--      party_similar         對象名稱跟既有對象很像，沒有自動新建
--      link_skipped          人看過、決定不連（之後不再自動比對）
--    - link_candidates   候選清單（jsonb，連結層寫、待連結頁讀）
--    - vendor_billing_account_id  支出屬於哪個廠商計費帳戶（＝哪一筆固定支出），連結層自動帶
--
-- 2. 固定支出併進廠商計費：vendor_billing_accounts 加排程欄位，recurring_expenses 的資料搬過去
--    （provider = other、source = manual 的「手動」帳戶）。recurring_expenses 表本身先留著不刪：
--    這支 migration 會先於新程式上線，舊程式在部署完成前還會讀它。下一支 migration 再 DROP。
--
-- 3. 既有交易補繼承：請款項 / 訂閱 → 合約、請款項 / 訂閱 / 合約 → 專案（只補空的，不覆蓋）。
--    沒有專案的合約不自動建專案（專案頁列出來讓人歸類）。
--
-- Forward-only，全部 additive。Run AFTER 0038_api_keys.sql。

-- ---- 1. 待連結 ----
ALTER TABLE transactions ADD COLUMN review_reason text;
ALTER TABLE transactions ADD COLUMN link_candidates jsonb;
ALTER TABLE transactions ADD COLUMN vendor_billing_account_id bigint
  REFERENCES vendor_billing_accounts(id) ON DELETE SET NULL;
ALTER TABLE transactions ADD CONSTRAINT chk_txn_review_reason CHECK (
  review_reason IS NULL OR review_reason = ANY (ARRAY[
    'link_suggested'::text, 'link_ambiguous'::text, 'link_amount_mismatch'::text, 'party_similar'::text, 'link_skipped'::text
  ])
);
CREATE INDEX idx_txn_review_reason ON transactions (organization_id)
  WHERE review_reason IS NOT NULL AND review_reason <> 'link_skipped' AND deleted_at IS NULL;
CREATE INDEX idx_txn_vendor_billing_account ON transactions (vendor_billing_account_id)
  WHERE vendor_billing_account_id IS NOT NULL;

COMMENT ON COLUMN transactions.review_reason IS '待連結原因（link_suggested / link_ambiguous / link_amount_mismatch / party_similar / link_skipped）；與 needs_review（分類待確認）分開';
COMMENT ON COLUMN transactions.link_candidates IS '連結層產生的候選：{ links: [...], party: { name, label, candidates: [...] } }';
COMMENT ON COLUMN transactions.vendor_billing_account_id IS '這筆支出屬於哪個廠商計費帳戶（固定支出）；連結層依對象自動帶';

-- ---- 2. 固定支出 → 廠商計費帳戶 ----
ALTER TABLE vendor_billing_accounts ADD COLUMN schedule text;
ALTER TABLE vendor_billing_accounts ADD COLUMN anchor_date date;
ALTER TABLE vendor_billing_accounts ADD COLUMN interval_months integer NOT NULL DEFAULT 1;
ALTER TABLE vendor_billing_accounts ADD COLUMN expected_amount numeric(18, 2);
ALTER TABLE vendor_billing_accounts ADD COLUMN currency char(3);
ALTER TABLE vendor_billing_accounts ADD COLUMN billing_url text;
ALTER TABLE vendor_billing_accounts ADD CONSTRAINT chk_vendor_billing_account_schedule CHECK (
  schedule IS NULL OR schedule = ANY (ARRAY['fixed'::text, 'usage'::text])
);
ALTER TABLE vendor_billing_accounts ADD CONSTRAINT chk_vendor_billing_account_anchor CHECK (
  schedule IS DISTINCT FROM 'fixed' OR anchor_date IS NOT NULL
);
ALTER TABLE vendor_billing_accounts ADD CONSTRAINT chk_vendor_billing_account_interval CHECK (
  interval_months >= 1 AND interval_months <= 36
);

COMMENT ON COLUMN vendor_billing_accounts.schedule IS '扣款週期：fixed = 依 anchor_date 每 interval_months 個月；usage = 用量計費、每月扣；NULL = 不提醒';
COMMENT ON COLUMN vendor_billing_accounts.expected_amount IS '預估每期金額（固定支出）';

INSERT INTO vendor_billing_accounts (
  organization_id, party_id, provider, external_id, display_name, payment_method_id,
  source, status, ledger_mode, meta, note,
  schedule, anchor_date, interval_months, expected_amount, currency, billing_url,
  created_at, updated_at, deleted_at
)
SELECT
  r.organization_id, r.party_id, 'other', NULL, r.name, r.payment_method_id,
  'manual', CASE WHEN r.is_active THEN 'active' ELSE 'closed' END, 'match_only',
  jsonb_strip_nulls(jsonb_build_object(
    'migratedFromRecurringExpenseId', r.id,
    'matchPattern', r.match_pattern
  )),
  r.note,
  r.schedule, r.anchor_date, r.interval_months, r.expected_amount, r.currency, r.billing_url,
  r.created_at, r.updated_at, r.deleted_at
FROM recurring_expenses r;

COMMENT ON TABLE recurring_expenses IS '已停用（0039）：資料已搬到 vendor_billing_accounts，下一支 migration 刪除';

-- ---- 3. 既有交易補繼承 ----
UPDATE transactions t
SET contract_id = src.contract_id
FROM (
  SELECT t2.id, coalesce(bi.contract_id, s.contract_id) AS contract_id
  FROM transactions t2
  LEFT JOIN billing_items bi ON bi.id = t2.billing_item_id
  LEFT JOIN subscriptions s ON s.id = t2.subscription_id
  WHERE t2.contract_id IS NULL AND coalesce(bi.contract_id, s.contract_id) IS NOT NULL
) src
WHERE t.id = src.id;

UPDATE transactions t
SET project_id = src.project_id
FROM (
  SELECT t2.id, coalesce(bi.project_id, s.project_id, c.project_id) AS project_id
  FROM transactions t2
  LEFT JOIN billing_items bi ON bi.id = t2.billing_item_id
  LEFT JOIN subscriptions s ON s.id = t2.subscription_id
  LEFT JOIN contracts c ON c.id = t2.contract_id
  WHERE t2.project_id IS NULL AND coalesce(bi.project_id, s.project_id, c.project_id) IS NOT NULL
) src
WHERE t.id = src.id;
