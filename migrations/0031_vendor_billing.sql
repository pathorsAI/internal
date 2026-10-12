-- 0031: 廠商計費帳號追蹤（付款方式、平台計費帳號與底下資源）+ 雲端帳單對帳。
--
-- 目的：記下「哪個平台的哪個計費帳號，用哪個付款方式在付」，Azure / GCP 用唯讀
-- integration 每天自動同步（src/lib/integrations/azure.ts、gcp.ts，provider 代號
-- 'azure' / 'gcp'），並把雲端帳單跟帳本對帳 —— 但**不重複記帳**：
--
-- 各組織本來就每月照信用卡帳單手動記一筆「每家廠商一列」的支出（台幣、含國外手續費，
-- from_account = 卡費扣款的銀行帳戶），而且一列常常涵蓋好幾張雲端發票（例如東蜂的
-- 「Google Cloud（5 張合併，含國外手續費）1,722」）。所以匯入的發票一律**先比對既有交易**
-- （src/lib/vendor-billing/match.ts）；只有明確設成 ledger_mode = 'create_unmatched' 的
-- 帳號、且發票日過了 45 天仍對不到時，才會新建一筆待確認的支出。預設 match_only 永遠不寫帳。
--
-- 五張表：
-- - payment_methods          付款方式：卡（只存卡別、末四碼、到期、持卡人，絕不存完整卡號）、
--                            經銷商帳單、銀行轉帳、Wise 卡…；settles_from_account_id = 費用最後從
--                            哪個帳本帳戶扣。source = azure 的是從 Azure paymentMethodLinks 同步來的。
-- - vendor_billing_accounts  平台計費帳號（Azure billing profile、GCP billing account、手動登記的
--                            Cloudflare 等）。一個平台可以多筆；狀態 active / closed / missing。
-- - vendor_billing_resources 計費帳號底下的資源（Azure subscription、GCP project）。
-- - vendor_invoices          雲端帳單（Azure 發票、GCP 由 BigQuery export 彙總的月帳），對帳狀態
--                            與綁定的交易。多張發票可以指向同一筆交易（卡費帳單合併列）。
-- - vendor_cost_lines        每月 × 資源 × 服務的費用明細。純分析資料，永遠不進帳本；每次同步覆寫。
--
-- 多租戶：每張表都有 organization_id。跨表參照（party、付款方式、帳本帳戶、交易）的同組織
-- 驗證在應用層（src/lib/vendor-billing/guards.ts），比照既有 assertInOrg 的作法。
-- 平台上消失的帳號 / 資源標成 missing，不刪除。
--
-- 也擴充 org_integrations 的 provider CHECK：加上 'azure'、'gcp'。
--
-- Forward-only，全部 additive。Run AFTER 0029（0030 保留給同期開發的另一個 PR）。

-- ---------------------------------------------------------------------------
-- org_integrations：新 provider
-- ---------------------------------------------------------------------------

ALTER TABLE org_integrations DROP CONSTRAINT chk_org_integration_provider;
ALTER TABLE org_integrations
  ADD CONSTRAINT chk_org_integration_provider
  CHECK (provider = ANY (ARRAY['simpany'::text, 'wise'::text, 'azure'::text, 'gcp'::text]));

COMMENT ON COLUMN org_integrations.provider IS '整合代號：simpany / wise / azure / gcp；對應 src/lib/integrations/catalog.ts';

-- ---------------------------------------------------------------------------
-- payment_methods
-- ---------------------------------------------------------------------------

CREATE TABLE payment_methods (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  kind text NOT NULL,
  -- 給人看的名稱，例如「MasterCard •2579」「TWGCP 經銷商帳單」
  label text NOT NULL,
  -- 卡別（MasterCard / Visa…）；不是卡就留空
  brand text,
  last4 char(4),
  expiry_month smallint,
  expiry_year smallint,
  holder_name text,
  -- 費用最後從哪個帳本帳戶扣（例如卡費從國泰世華扣）
  settles_from_account_id bigint REFERENCES bank_accounts(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual',
  -- 同步來源端的 id（Azure 的 payment method id）；手動輸入為 NULL
  external_ref text,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_payment_method_kind
    CHECK (kind = ANY (ARRAY['card'::text, 'reseller_invoice'::text, 'bank_transfer'::text, 'wise_card'::text, 'other'::text])),
  CONSTRAINT chk_payment_method_source
    CHECK (source = ANY (ARRAY['manual'::text, 'azure'::text])),
  CONSTRAINT chk_payment_method_last4 CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),
  CONSTRAINT chk_payment_method_expiry_month CHECK (expiry_month IS NULL OR expiry_month BETWEEN 1 AND 12),
  CONSTRAINT chk_payment_method_expiry_year CHECK (expiry_year IS NULL OR expiry_year BETWEEN 2000 AND 2100),
  CONSTRAINT chk_payment_method_external_ref
    CHECK (external_ref IS NULL OR source <> 'manual')
);

CREATE INDEX idx_payment_method_org ON payment_methods (organization_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_payment_method_external_ref
  ON payment_methods (organization_id, source, external_ref)
  WHERE external_ref IS NOT NULL;

COMMENT ON TABLE payment_methods IS '付款方式（卡、經銷商帳單、銀行轉帳、Wise 卡…）；只存卡別、末四碼、到期、持卡人，絕不存完整卡號';
COMMENT ON COLUMN payment_methods.kind IS 'card / reseller_invoice / bank_transfer / wise_card / other';
COMMENT ON COLUMN payment_methods.settles_from_account_id IS '費用最後從哪個帳本帳戶扣（bank_accounts.id，同組織）';
COMMENT ON COLUMN payment_methods.source IS 'manual（手動）/ azure（Azure paymentMethodLinks 同步）';
COMMENT ON COLUMN payment_methods.external_ref IS '同步來源端的 id；與 org + source 組成去重鍵';

-- ---------------------------------------------------------------------------
-- vendor_billing_accounts
-- ---------------------------------------------------------------------------

CREATE TABLE vendor_billing_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  -- 帳本上的廠商（交易對象）；對帳只看有設 party 的帳號
  party_id bigint REFERENCES parties(id) ON DELETE SET NULL,
  provider text NOT NULL,
  -- 平台上的 id：Azure billing profile name、GCP billing account id；手動登記可留空
  external_id text,
  display_name text NOT NULL,
  payment_method_id bigint REFERENCES payment_methods(id) ON DELETE SET NULL,
  owner_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'active',
  -- match_only：只對帳、永遠不寫帳本（預設）；create_unmatched：發票日 45 天後仍對不到才新建待確認支出
  ledger_mode text NOT NULL DEFAULT 'match_only',
  -- 手動帳號最後一次有人確認資料無誤的時間（超過 180 天會提醒）
  last_verified_at timestamptz,
  -- 同步帳號最後一次在平台上看到的時間
  last_seen_at timestamptz,
  -- 非機密細節：{ masterBillingAccount, currency, reseller: true, billingAccountId … }
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_vendor_billing_account_provider
    CHECK (provider = ANY (ARRAY['azure'::text, 'gcp'::text, 'aws'::text, 'cloudflare'::text, 'other'::text])),
  CONSTRAINT chk_vendor_billing_account_source
    CHECK (source = ANY (ARRAY['manual'::text, 'synced'::text])),
  CONSTRAINT chk_vendor_billing_account_status
    CHECK (status = ANY (ARRAY['active'::text, 'closed'::text, 'missing'::text])),
  CONSTRAINT chk_vendor_billing_account_ledger_mode
    CHECK (ledger_mode = ANY (ARRAY['match_only'::text, 'create_unmatched'::text])),
  CONSTRAINT chk_vendor_billing_account_synced_external_id
    CHECK (source = 'manual' OR external_id IS NOT NULL)
);

CREATE INDEX idx_vendor_billing_account_org
  ON vendor_billing_accounts (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_vendor_billing_account_payment_method
  ON vendor_billing_accounts (payment_method_id) WHERE payment_method_id IS NOT NULL;
CREATE INDEX idx_vendor_billing_account_party
  ON vendor_billing_accounts (party_id) WHERE party_id IS NOT NULL;
CREATE UNIQUE INDEX uq_vendor_billing_account_external
  ON vendor_billing_accounts (organization_id, provider, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON TABLE vendor_billing_accounts IS '平台計費帳號（Azure billing profile、GCP billing account、手動登記的其他平台）與它的付款方式';
COMMENT ON COLUMN vendor_billing_accounts.external_id IS '平台上的 id；與 org + provider 組成唯一鍵（手動可為 NULL）';
COMMENT ON COLUMN vendor_billing_accounts.status IS 'active / closed（平台上已關閉）/ missing（同步時平台上找不到，不刪除）';
COMMENT ON COLUMN vendor_billing_accounts.ledger_mode IS 'match_only（只對帳，預設）/ create_unmatched（發票日 45 天後仍對不到才新建待確認支出）';
COMMENT ON COLUMN vendor_billing_accounts.meta IS '非機密細節（masterBillingAccount、currency、reseller…）；只給人看';

-- ---------------------------------------------------------------------------
-- vendor_billing_resources
-- ---------------------------------------------------------------------------

CREATE TABLE vendor_billing_resources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  billing_account_id bigint NOT NULL REFERENCES vendor_billing_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  external_id text NOT NULL,
  name text,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_vendor_billing_resource UNIQUE (billing_account_id, external_id),
  CONSTRAINT chk_vendor_billing_resource_kind
    CHECK (kind = ANY (ARRAY['azure_subscription'::text, 'gcp_project'::text, 'other'::text])),
  CONSTRAINT chk_vendor_billing_resource_status
    CHECK (status = ANY (ARRAY['active'::text, 'missing'::text]))
);

CREATE INDEX idx_vendor_billing_resource_org ON vendor_billing_resources (organization_id);

COMMENT ON TABLE vendor_billing_resources IS '計費帳號底下的資源（Azure subscription、GCP project）；平台上消失標 missing，不刪除';

-- ---------------------------------------------------------------------------
-- vendor_invoices
-- ---------------------------------------------------------------------------

CREATE TABLE vendor_invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  billing_account_id bigint NOT NULL REFERENCES vendor_billing_accounts(id),
  -- Azure：發票號碼（invoice name）；GCP：`<billingAccountId>:<YYYYMM>`
  external_ref text NOT NULL,
  source text NOT NULL,
  period_start date,
  period_end date,
  invoice_date date NOT NULL,
  amount numeric(18, 2) NOT NULL,
  currency char(3) NOT NULL,
  -- 平台上的狀態原文（Azure：Due / Paid / Void…）
  status text,
  match_status text NOT NULL DEFAULT 'unmatched',
  -- 多張發票可以指向同一筆交易（卡費帳單一列合併好幾張雲端發票）
  matched_transaction_id bigint REFERENCES transactions(id) ON DELETE SET NULL,
  suggested_transaction_id bigint REFERENCES transactions(id) ON DELETE SET NULL,
  matched_at timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_vendor_invoice UNIQUE (organization_id, source, external_ref),
  CONSTRAINT chk_vendor_invoice_source
    CHECK (source = ANY (ARRAY['azure_invoice'::text, 'gcp_bigquery'::text])),
  CONSTRAINT chk_vendor_invoice_match_status
    CHECK (match_status = ANY (ARRAY['unmatched'::text, 'suggested'::text, 'matched'::text, 'manual'::text, 'created'::text, 'ignored'::text])),
  CONSTRAINT chk_vendor_invoice_currency CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX idx_vendor_invoice_org_status ON vendor_invoices (organization_id, match_status);
CREATE INDEX idx_vendor_invoice_account ON vendor_invoices (billing_account_id, invoice_date DESC);
CREATE INDEX idx_vendor_invoice_matched_txn
  ON vendor_invoices (matched_transaction_id) WHERE matched_transaction_id IS NOT NULL;

COMMENT ON TABLE vendor_invoices IS '雲端帳單（Azure 發票、GCP BigQuery 月彙總）與對帳狀態；先比對既有交易，不重複記帳';
COMMENT ON COLUMN vendor_invoices.match_status IS 'unmatched / suggested（有建議待確認）/ matched（自動）/ manual（人工綁定）/ created（帳號設 create_unmatched 而新建的交易）/ ignored';
COMMENT ON COLUMN vendor_invoices.matched_transaction_id IS '綁定的帳本交易；多張發票可指向同一筆（卡費帳單合併列）';

-- ---------------------------------------------------------------------------
-- vendor_cost_lines
-- ---------------------------------------------------------------------------

CREATE TABLE vendor_cost_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  billing_account_id bigint NOT NULL REFERENCES vendor_billing_accounts(id) ON DELETE CASCADE,
  -- 月份（該月 1 號）
  month date NOT NULL,
  -- 資源 id（Azure subscription id、GCP project id）；沒有資源的費用（支援方案等）為空字串
  resource_external_id text NOT NULL DEFAULT '',
  resource_name text,
  service text NOT NULL DEFAULT '',
  amount numeric(18, 4) NOT NULL,
  currency char(3) NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_vendor_cost_line UNIQUE (billing_account_id, month, resource_external_id, service, source),
  CONSTRAINT chk_vendor_cost_line_source
    CHECK (source = ANY (ARRAY['azure_cost'::text, 'gcp_bigquery'::text])),
  CONSTRAINT chk_vendor_cost_line_month CHECK (EXTRACT(day FROM month) = 1),
  CONSTRAINT chk_vendor_cost_line_currency CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX idx_vendor_cost_line_org_month ON vendor_cost_lines (organization_id, month);

COMMENT ON TABLE vendor_cost_lines IS '雲端費用明細（月 × 資源 × 服務）；純分析資料，永遠不進帳本，每次同步覆寫金額';
