-- 0040: 營業稅別（合約／訂閱／請款項目的金額是未稅還是含稅、要不要加收 5%）。
--
-- 問題：合約、訂閱、請款項目都只有一個 amount，報價單寫「金額（未稅）」，所以存的是未稅；
-- 稅只在開發票時臨時選。結果列表看不到客戶實際要付的含稅金額，收齊判斷也拿入帳（含稅）去比未稅，
-- 有加 5% 的客戶每期都對不起來。
--
-- - tax_treatment  taxable（應稅 5%）| zero_rated（零稅率）| exempt（免稅）| none（不加收，例如小規模營業人）
-- - amount_basis   net（amount 是未稅）| gross（amount 是含稅）
--
-- 組織預設：organization 上兩欄 NOT NULL，預設 taxable + net。合約／訂閱／請款項目上兩欄可為 NULL＝沿用：
-- 訂閱與請款項目有綁合約就跟著合約，沒綁就看自己，NULL 沿用組織預設（src/lib/tax-treatment.ts）。
-- 既有資料全部留 NULL，也就是沿用組織預設。
--
-- 兩個既有組織的預設：派斯（org_pathors）應稅＋未稅；東蜂（org-1780675700917）不加收
-- （威澄入帳剛好是未稅金額，也沒開過發票，推測是小規模營業人）。在沒有這兩個組織的資料庫上 UPDATE 不會動到任何列。
--
-- 程式比這支 migration 先上會壞（auth-schema 的 organization 與三張表都會 select 新欄位）。先跑 migration 再部署。
--
-- Forward-only，全部 additive。Run AFTER 0039。

ALTER TABLE organization ADD COLUMN tax_treatment text NOT NULL DEFAULT 'taxable';
ALTER TABLE organization ADD COLUMN amount_basis text NOT NULL DEFAULT 'net';
ALTER TABLE organization ADD CONSTRAINT chk_org_tax_treatment
  CHECK (tax_treatment = ANY (ARRAY['taxable', 'zero_rated', 'exempt', 'none']));
ALTER TABLE organization ADD CONSTRAINT chk_org_amount_basis
  CHECK (amount_basis = ANY (ARRAY['net', 'gross']));

ALTER TABLE contracts ADD COLUMN tax_treatment text;
ALTER TABLE contracts ADD COLUMN amount_basis text;
ALTER TABLE contracts ADD CONSTRAINT chk_contract_tax_treatment
  CHECK (tax_treatment IS NULL OR tax_treatment = ANY (ARRAY['taxable', 'zero_rated', 'exempt', 'none']));
ALTER TABLE contracts ADD CONSTRAINT chk_contract_amount_basis
  CHECK (amount_basis IS NULL OR amount_basis = ANY (ARRAY['net', 'gross']));

ALTER TABLE subscriptions ADD COLUMN tax_treatment text;
ALTER TABLE subscriptions ADD COLUMN amount_basis text;
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscription_tax_treatment
  CHECK (tax_treatment IS NULL OR tax_treatment = ANY (ARRAY['taxable', 'zero_rated', 'exempt', 'none']));
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscription_amount_basis
  CHECK (amount_basis IS NULL OR amount_basis = ANY (ARRAY['net', 'gross']));

ALTER TABLE billing_items ADD COLUMN tax_treatment text;
ALTER TABLE billing_items ADD COLUMN amount_basis text;
ALTER TABLE billing_items ADD CONSTRAINT chk_billing_item_tax_treatment
  CHECK (tax_treatment IS NULL OR tax_treatment = ANY (ARRAY['taxable', 'zero_rated', 'exempt', 'none']));
ALTER TABLE billing_items ADD CONSTRAINT chk_billing_item_amount_basis
  CHECK (amount_basis IS NULL OR amount_basis = ANY (ARRAY['net', 'gross']));

UPDATE organization SET tax_treatment = 'taxable', amount_basis = 'net' WHERE id = 'org_pathors';
UPDATE organization SET tax_treatment = 'none', amount_basis = 'net' WHERE id = 'org-1780675700917';
