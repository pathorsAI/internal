-- 0037: 雲端費用明細把 Google 抵用點數（promotion credits）分開存。
--
-- 原本 vendor_cost_lines.amount 存的是 GCP 的淨額（用量 cost + 全部 credits），被點數抵掉的
-- 成本就看不到了。現在拆成兩欄：
--
-- - gross_amount      沒有點數時要付的錢 = cost + 非 PROMOTION 的 credits（免費額度、續用折扣、
--                     承諾折扣等視為真的折扣，直接降低成本）。
-- - promotion_credit  PROMOTION 類 credits 加總（負數，沒有就是 0）。
-- - amount            不變，仍是淨額 = gross_amount + promotion_credit（月帳單、對帳照舊用它）。
--
-- 既有資料（含 Azure 列）：gross_amount = amount、promotion_credit = 0。
-- gross_amount 刻意留成可為 NULL：這支 migration 會先於新程式上線，舊程式寫入時不帶這欄；
-- 讀取端一律 COALESCE(gross_amount, amount)。新程式每次同步都會覆寫成正確值。
--
-- Forward-only，全部 additive。Run AFTER 0036_ai_assistant.sql。

ALTER TABLE vendor_cost_lines ADD COLUMN gross_amount numeric(18, 4);
ALTER TABLE vendor_cost_lines ADD COLUMN promotion_credit numeric(18, 4) NOT NULL DEFAULT 0;

UPDATE vendor_cost_lines SET gross_amount = amount WHERE gross_amount IS NULL;

COMMENT ON COLUMN vendor_cost_lines.amount IS '淨額 = gross_amount + promotion_credit（實際要付的錢）';
COMMENT ON COLUMN vendor_cost_lines.gross_amount IS '沒有抵用點數時要付的錢（GCP：cost + 非 PROMOTION credits）；NULL 視同 amount';
COMMENT ON COLUMN vendor_cost_lines.promotion_credit IS 'GCP PROMOTION credits（抵用點數）加總，負數；Azure 為 0';
