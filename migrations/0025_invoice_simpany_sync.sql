-- 0025: 發票與 Simpany 的 API 同步 / 開立。
--
-- 0019 把 Simpany 當成「人工開票 + 上傳匯出檔對帳」的外部系統；0023 建好整合框架之後，
-- 改用 Simpany 會員網頁背後的（非公開）API 直接同步與開立（src/lib/integrations/simpany.ts、
-- src/lib/simpany-sync.ts、src/lib/simpany-issue.ts）。xlsx 對帳頁保留，API 同步取代它。
--
-- 本 migration：
--   (1) invoices 補上 Simpany 發票的完整事實：課稅別、零稅率原因、外幣與匯率、B2B/B2C、
--       Simpany 的 R… id、作廢時間與原因、買受人 email、訂閱期別綁定、最後同步時間。
--       這些欄位也就是 docs/export-vat-tracking-design.md §4 提議過的那組（twd_sales_amount
--       不另開欄位：Simpany 開出的發票金額本來就是台幣銷售額，即 amount_gross）。
--   (2) invoice_drafts：開立前的「預覽草稿」。MCP / web 先 preview 產生一筆草稿（內含要送給
--       Simpany 的完整 request body），使用者明確確認後才以 draftId 開立 —— 開立只接受
--       draftId，不接受任何其他內容，確保「看過的」就是「送出去的」。
--
-- 既有語意不變：external_ref = 發票號碼（對帳鍵），external_status = pending/issued/void/n_a。
-- Forward-only，全部 additive。Run AFTER 0023_org_integrations.sql（0024 保留給同期的 Wise 分支）。

-- (1) invoices
ALTER TABLE invoices ADD COLUMN tax_treatment text NOT NULL DEFAULT 'taxable';
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_tax_treatment
  CHECK (tax_treatment = ANY (ARRAY['taxable'::text, 'zero_rated'::text, 'exempt'::text]));

-- Simpany 的零稅率原因代碼（'71' 外銷貨物、'72' 外銷勞務 …）；tax_treatment = zero_rated 時填
ALTER TABLE invoices ADD COLUMN zero_rate_reason text;

-- 外幣收款開零稅率發票時的換算依據：匯率（取自銀行水單）、外幣幣別與金額。
-- amount_gross 仍是發票上的台幣金額（= round(foreign_amount × exchange_rate)）。
ALTER TABLE invoices ADD COLUMN exchange_rate numeric(12,6);
ALTER TABLE invoices ADD COLUMN foreign_currency text;
ALTER TABLE invoices ADD COLUMN foreign_amount numeric(14,2);

ALTER TABLE invoices ADD COLUMN invoice_type text;
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_type
  CHECK (invoice_type IS NULL OR invoice_type = ANY (ARRAY['B2B'::text, 'B2C'::text]));

-- Simpany 的發票 id（'R260903181235059' 這種），API 取明細 / 作廢都要用它，不是發票號碼
ALTER TABLE invoices ADD COLUMN external_id text;
ALTER TABLE invoices ADD COLUMN voided_at timestamptz;
ALTER TABLE invoices ADD COLUMN void_reason text;
ALTER TABLE invoices ADD COLUMN buyer_emails text[];

-- 訂閱期別綁定：訂閱期別不物化（見 0014 / 0017），所以只存 subscription_id + 期別起日，
-- 與 transactions.subscription_id / subscription_period 同一套。
ALTER TABLE invoices ADD COLUMN subscription_id bigint REFERENCES subscriptions(id);
ALTER TABLE invoices ADD COLUMN subscription_period date;

ALTER TABLE invoices ADD COLUMN external_synced_at timestamptz;

CREATE UNIQUE INDEX uq_invoice_external_id ON invoices (organization_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX idx_invoice_subscription ON invoices (subscription_id, subscription_period)
  WHERE subscription_id IS NOT NULL;

COMMENT ON COLUMN invoices.tax_treatment IS '課稅別：taxable（應稅）/ zero_rated（零稅率）/ exempt（免稅）';
COMMENT ON COLUMN invoices.zero_rate_reason IS 'Simpany 零稅率原因代碼（71 外銷貨物、72 外銷勞務 …）';
COMMENT ON COLUMN invoices.exchange_rate IS '外幣換算台幣的匯率（取自銀行水單）';
COMMENT ON COLUMN invoices.foreign_currency IS '外幣收款的幣別（USD 等）';
COMMENT ON COLUMN invoices.foreign_amount IS '外幣金額；amount_gross = round(foreign_amount × exchange_rate)';
COMMENT ON COLUMN invoices.invoice_type IS 'B2B（有統編）/ B2C';
COMMENT ON COLUMN invoices.external_id IS 'Simpany 發票 id（R…），API 用；external_ref 仍是發票號碼';
COMMENT ON COLUMN invoices.voided_at IS 'Simpany 作廢時間';
COMMENT ON COLUMN invoices.void_reason IS 'Simpany 作廢原因';
COMMENT ON COLUMN invoices.buyer_emails IS '開立通知寄送的買受人 email';
COMMENT ON COLUMN invoices.subscription_id IS '這張發票對應的訂閱（與 subscription_period 一起用）';
COMMENT ON COLUMN invoices.subscription_period IS '對應的訂閱期別起日';
COMMENT ON COLUMN invoices.external_synced_at IS '最後一次從 Simpany API 同步此列的時間';

-- (2) invoice_drafts
CREATE TABLE invoice_drafts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  -- { type: 'b2b' | 'b2c', body: <送給 Simpany 的 request body 原樣> }
  payload jsonb NOT NULL,
  -- 給人看的預覽：買受人、品項、未稅 / 稅額 / 總額、課稅別、警示、外幣換算
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 開立後要回寫的綁定：transactionIds、billingItemId、subscriptionId + subscriptionPeriod、
  -- contractId、partyId
  links jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  issued_invoice_id bigint REFERENCES invoices(id),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_invoice_draft_status
    CHECK (status = ANY (ARRAY['pending'::text, 'issued'::text, 'cancelled'::text, 'expired'::text]))
);

CREATE INDEX idx_invoice_draft_org ON invoice_drafts (organization_id, created_at DESC);

COMMENT ON TABLE invoice_drafts IS 'Simpany 開立前的預覽草稿；開立只接受 draft id（看過的 = 送出的），2 小時過期';
COMMENT ON COLUMN invoice_drafts.payload IS '{ type, body }：送給 Simpany POST receipts/{type} 的原樣內容';
COMMENT ON COLUMN invoice_drafts.status IS 'pending / issued / cancelled（送出失敗或結果不明）/ expired';
