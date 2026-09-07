-- 0022: subscriptions.contract_id（訂閱可綁定合約）。
--
-- 為什麼需要：訂閱（週期性月費）與合約是兩張各自獨立的表，訂閱只能掛專案
-- （project_id），掛不到合約。但週期性費用多半是合約裡談好的條件 —— 合約寫「每月
-- 維運費 30,000」，系統裡卻只有一張孤兒訂閱，回頭要問「這筆月費是哪張合約來的」
-- 沒有任何欄位答得出來，只能靠方案名稱猜。請款看板上的訂閱期別也因此永遠是
-- contract_id = NULL，跟 billing_items 那側的合約欄位對不起來。
--
-- 一次性分期走 billing_items.contract_id，週期性月費走本欄位，兩邊語意一致。
-- 刻意維持選填：既有訂閱不見得對得到合約，也有純口頭約定的月費。
--
-- Forward-only, additive. 既有資料一律 NULL，不需要 backfill。

ALTER TABLE subscriptions
  ADD COLUMN contract_id bigint REFERENCES contracts(id);

-- 合約詳情頁要反查「這張合約綁了哪些訂閱」，比照 idx_billing_item_contract。
CREATE INDEX idx_subscriptions_contract ON subscriptions(contract_id);
