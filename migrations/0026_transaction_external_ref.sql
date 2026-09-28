-- 0026: 交易的外部來源標記（Wise 交易同步，之後其他銀行 / 卡片 feed 共用）。
--
-- 目的：從外部服務自動匯入的交易，要能 (1) 永遠不重複寫入、(2) 留下原始細節供對帳、
-- (3) 標出「還沒有人看過」的列。手動輸入的交易這四欄都是 NULL / false，行為不變。
--
-- - external_source  來源代號，例如 'wise'。手動輸入 = NULL。
-- - external_ref     來源端的唯一鍵（Wise 的 referenceNumber，例如 'CARD-4370840324'；
--                    換匯兩腳各一列，鍵加上幣別後綴，見 src/lib/wise-sync.ts）。
-- - external_meta    非機密的原始細節：商家、原幣金額、匯率、手續費、卡號末四碼、持卡人、
--                    Wise 分類。只給人對帳看，程式不依賴它的形狀做判斷。
-- - needs_review     自動匯入的列預設 true（分類留空、待人確認）；在 web 編輯並指定分類、
--                    或 MCP update_transaction 指定分類時清掉。
--
-- 去重：(organization_id, external_source, external_ref) 的部分唯一索引。同步程式用
-- ON CONFLICT DO NOTHING 寫入，所以就算兩次同步重疊也不會寫兩次；既有的列不會被改動。
--
-- Forward-only，全部 additive（新欄位皆可為 NULL 或有預設值）。
-- Run AFTER 0023_org_integrations.sql（0024 / 0025 保留給同期開發的 Simpany 整合）。

ALTER TABLE transactions ADD COLUMN external_source text;
ALTER TABLE transactions ADD COLUMN external_ref text;
ALTER TABLE transactions ADD COLUMN external_meta jsonb;
ALTER TABLE transactions ADD COLUMN needs_review boolean NOT NULL DEFAULT false;

ALTER TABLE transactions
  ADD CONSTRAINT chk_txn_external_ref_source
  CHECK (external_ref IS NULL OR external_source IS NOT NULL);

CREATE UNIQUE INDEX uq_txn_external_ref
  ON transactions (organization_id, external_source, external_ref)
  WHERE external_ref IS NOT NULL;

-- 「待確認」清單用：只索引少數 needs_review = true 的列。
CREATE INDEX idx_txn_needs_review
  ON transactions (organization_id)
  WHERE needs_review AND deleted_at IS NULL;

COMMENT ON COLUMN transactions.external_source IS '外部來源代號（wise…）；手動輸入為 NULL';
COMMENT ON COLUMN transactions.external_ref IS '外部來源的唯一鍵（Wise referenceNumber），與 org + source 組成去重鍵';
COMMENT ON COLUMN transactions.external_meta IS '外部來源的原始細節（商家、原幣、匯率、手續費…），僅供對帳顯示';
COMMENT ON COLUMN transactions.needs_review IS '自動匯入待人確認；指定分類後清掉';
