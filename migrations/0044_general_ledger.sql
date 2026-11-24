-- 0044: 總帳與財務報表（docs/general-ledger.md）。
--
-- 交易、發票照舊是輸入；src/lib/ledger 的 posting engine 把它們照規則轉成分錄，報表只讀分錄。
-- 開放期間的分錄每次即時從來源算（不會跟來源漂移）；結帳的月份把當月分錄存成快照
-- （journal_entries.kind = 'snapshot'），之後報表讀快照，來源也被下面的 trigger 鎖住。
--
-- 兩本帳（ledger）：
--   government  政府帳：只含 ledger_scope = 'government' 的帳戶與 book <> 'internal' 的認列；
--               不屬於政府帳的那一側一律沖「股東往來」，所以政府帳自己就借貸平衡、銀行餘額對得上對帳單。
--   management  管理帳：全部交易、全部帳戶。
--
-- 1. org_accounting_settings  國家模組、會計準則、營業稅制、會計年度、帳本起始日、期初餘額沖轉科目
-- 2. gl_accounts              每個組織自己的科目表（從國家模組的範本建立，可增改）
-- 3. categories / bank_accounts 加 gl_account_id（NULL = 用模組的預設對應）；bank_accounts 加 ledger_scope
-- 4. fx_rates                 匯率（外幣交易沒有 amount_twd 時換算、期末外幣評價）
-- 5. journal_entries / journal_lines  手動分錄（期初、調整、年結）與結帳快照；每張借貸相等由 trigger 擋
-- 6. fiscal_periods           月結狀態
-- 7. fixed_assets             財產目錄（直線法折舊即時計算）
-- 8. 結帳鎖定 trigger：已結帳月份的交易、發票、手動分錄、財產不能新增、修改、刪除會計相關欄位
--
-- Forward-only，全部 additive。Run AFTER 0043_payment_allocations.sql。

-- ---- 1. 組織會計設定 ----
CREATE TABLE org_accounting_settings (
  organization_id text PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
  jurisdiction text NOT NULL DEFAULT 'TW',
  framework text NOT NULL DEFAULT 'TW-EAS',
  vat_regime text NOT NULL DEFAULT 'general',
  fiscal_year_start_month smallint NOT NULL DEFAULT 1,
  functional_currency char(3) NOT NULL DEFAULT 'TWD',
  books_start_date date,
  opening_equity_account_id bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_oas_vat_regime CHECK (vat_regime = ANY (ARRAY['general', 'small_scale', 'none'])),
  CONSTRAINT chk_oas_fy_month CHECK (fiscal_year_start_month BETWEEN 1 AND 12)
);
COMMENT ON TABLE org_accounting_settings IS '總帳設定；沒有這列時用預設（TW、TW-EAS、營業稅制依 organization.tax_treatment 推：none → small_scale）';
COMMENT ON COLUMN org_accounting_settings.books_start_date IS '總帳從哪天開始；NULL = 最早一筆交易日。之前的交易併進期初餘額';
COMMENT ON COLUMN org_accounting_settings.opening_equity_account_id IS '帳戶期初餘額的對方科目；NULL = 模組預設（台灣：股本）';

-- ---- 2. 科目表 ----
CREATE TABLE gl_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  name_en text,
  type text NOT NULL,
  section text NOT NULL,
  cash_flow text NOT NULL DEFAULT 'operating',
  system_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_gl_type CHECK (type = ANY (ARRAY['asset', 'liability', 'equity', 'revenue', 'expense'])),
  CONSTRAINT chk_gl_cash_flow CHECK (cash_flow = ANY (ARRAY['cash', 'operating', 'investing', 'financing', 'none'])),
  CONSTRAINT uq_gl_code UNIQUE (organization_id, code)
);
CREATE UNIQUE INDEX uq_gl_system_key ON gl_accounts (organization_id, system_key) WHERE system_key IS NOT NULL;
COMMENT ON COLUMN gl_accounts.section IS '報表上的區塊，值由國家模組定義（例：current_assets、operating_expense）';
COMMENT ON COLUMN gl_accounts.system_key IS 'posting engine 要用的固定科目（ar、output_vat、shareholder…）；一個組織每個 key 只有一個';

ALTER TABLE org_accounting_settings
  ADD CONSTRAINT fk_oas_opening_equity FOREIGN KEY (opening_equity_account_id) REFERENCES gl_accounts(id) ON DELETE SET NULL;

-- ---- 3. 對應 ----
ALTER TABLE categories ADD COLUMN gl_account_id bigint REFERENCES gl_accounts(id) ON DELETE SET NULL;
ALTER TABLE bank_accounts ADD COLUMN gl_account_id bigint REFERENCES gl_accounts(id) ON DELETE SET NULL;
ALTER TABLE bank_accounts ADD COLUMN ledger_scope text NOT NULL DEFAULT 'government';
ALTER TABLE bank_accounts ADD CONSTRAINT chk_bank_ledger_scope CHECK (ledger_scope = ANY (ARRAY['government', 'management']));
COMMENT ON COLUMN bank_accounts.ledger_scope IS 'government = 政府看得到的帳戶（進政府帳）；management = 只在管理帳（政府帳上這側沖股東往來）';

-- ---- 4. 匯率 ----
CREATE TABLE fx_rates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  currency char(3) NOT NULL,
  rate_date date NOT NULL,
  rate numeric(14, 6) NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_fx_rate_positive CHECK (rate > 0),
  CONSTRAINT uq_fx_rate UNIQUE (organization_id, currency, rate_date)
);
COMMENT ON COLUMN fx_rates.rate IS '1 單位外幣 = rate 單位本位幣';

-- ---- 5. 分錄 ----
CREATE TABLE journal_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  ledger text NOT NULL DEFAULT 'both',
  kind text NOT NULL DEFAULT 'manual',
  entry_date date NOT NULL,
  memo text,
  snapshot_year smallint,
  snapshot_month smallint,
  source_type text,
  source_id bigint,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_je_ledger CHECK (ledger = ANY (ARRAY['both', 'government', 'management'])),
  CONSTRAINT chk_je_kind CHECK (kind = ANY (ARRAY['manual', 'opening', 'adjustment', 'snapshot'])),
  CONSTRAINT chk_je_snapshot CHECK ((kind = 'snapshot') = (snapshot_year IS NOT NULL AND snapshot_month IS NOT NULL))
);
CREATE INDEX idx_je_org_date ON journal_entries (organization_id, entry_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_je_snapshot ON journal_entries (organization_id, snapshot_year, snapshot_month) WHERE kind = 'snapshot';
COMMENT ON COLUMN journal_entries.ledger IS 'both = 兩本帳都有；snapshot 一律是 government 或 management 其中之一';
COMMENT ON COLUMN journal_entries.source_type IS '快照分錄的來源（transaction、invoice、fixed_asset、opening…），手動分錄為 NULL';

CREATE TABLE journal_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  gl_account_id bigint NOT NULL REFERENCES gl_accounts(id),
  debit numeric(18, 2) NOT NULL DEFAULT 0,
  credit numeric(18, 2) NOT NULL DEFAULT 0,
  currency char(3),
  fx_amount numeric(18, 2),
  party_id bigint REFERENCES parties(id) ON DELETE SET NULL,
  employee_id bigint REFERENCES employees(id) ON DELETE SET NULL,
  bank_account_id bigint REFERENCES bank_accounts(id) ON DELETE SET NULL,
  memo text,
  CONSTRAINT chk_jl_amounts CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))
);
CREATE INDEX idx_jl_entry ON journal_lines (entry_id);
CREATE INDEX idx_jl_account ON journal_lines (gl_account_id);
COMMENT ON COLUMN journal_lines.fx_amount IS '外幣原幣金額（帶正負：借正貸負），currency 為原幣；本位幣金額在 debit / credit';

-- 每張分錄借貸相等：交易結束時檢查（deferred），讓同一個交易裡先寫表頭、再寫多列分錄。
CREATE FUNCTION journal_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  eid bigint := COALESCE(NEW.entry_id, OLD.entry_id);
  diff numeric;
BEGIN
  SELECT COALESCE(sum(debit), 0) - COALESCE(sum(credit), 0) INTO diff FROM journal_lines WHERE entry_id = eid;
  IF diff <> 0 AND EXISTS (SELECT 1 FROM journal_entries WHERE id = eid) THEN
    RAISE EXCEPTION 'JOURNAL_UNBALANCED: entry % debit - credit = %', eid, diff;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_journal_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();

-- ---- 6. 會計期間 ----
CREATE TABLE fiscal_periods (
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  year smallint NOT NULL,
  month smallint NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  closed_by text,
  PRIMARY KEY (organization_id, year, month),
  CONSTRAINT chk_fp_month CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT chk_fp_status CHECK (status = ANY (ARRAY['open', 'closed']))
);

-- ---- 7. 財產目錄 ----
CREATE TABLE fixed_assets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name text NOT NULL,
  acquired_on date NOT NULL,
  cost numeric(18, 2) NOT NULL,
  salvage_value numeric(18, 2) NOT NULL DEFAULT 0,
  useful_life_months integer NOT NULL,
  asset_account_id bigint REFERENCES gl_accounts(id) ON DELETE SET NULL,
  source_transaction_id bigint REFERENCES transactions(id) ON DELETE SET NULL,
  disposed_on date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_fa_cost CHECK (cost > 0 AND salvage_value >= 0 AND salvage_value < cost),
  CONSTRAINT chk_fa_life CHECK (useful_life_months BETWEEN 1 AND 600)
);
CREATE UNIQUE INDEX uq_fa_source_txn ON fixed_assets (source_transaction_id) WHERE source_transaction_id IS NOT NULL AND deleted_at IS NULL;
COMMENT ON COLUMN fixed_assets.source_transaction_id IS '買這項財產的支出交易；有綁的話那筆支出改記資產，不記費用';

-- ---- 8. 結帳鎖定 ----
CREATE FUNCTION period_is_closed(org text, d date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT d IS NOT NULL AND EXISTS (
    SELECT 1 FROM fiscal_periods
    WHERE organization_id = org AND year = extract(year FROM d) AND month = extract(month FROM d) AND status = 'closed'
  )
$$;

CREATE FUNCTION guard_closed_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  date_col text := TG_ARGV[0];
  new_date date;
  old_date date;
  org text;
BEGIN
  -- 結帳快照本身就是結帳時寫的，不擋。
  -- 巢狀 IF：plpgsql 只在執行到時才規劃語句，其他表沒有 kind 欄位也不會出錯。
  IF TG_TABLE_NAME = 'journal_entries' THEN
    IF (TG_OP <> 'DELETE' AND NEW.kind = 'snapshot') OR (TG_OP = 'DELETE' AND OLD.kind = 'snapshot') THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    EXECUTE format('SELECT ($1).%I::date', date_col) INTO new_date USING NEW;
    org := NEW.organization_id;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    EXECUTE format('SELECT ($1).%I::date', date_col) INTO old_date USING OLD;
    org := COALESCE(org, OLD.organization_id);
  END IF;
  -- UPDATE 只擋會影響帳的欄位有變（TG_ARGV[1..] 列出來）；其他欄位（備註、待審旗標）照樣可改。
  IF TG_OP = 'UPDATE' THEN
    DECLARE
      col text;
      changed boolean := false;
      a text;
      b text;
    BEGIN
      FOREACH col IN ARRAY TG_ARGV[1:] LOOP
        EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', col, col) INTO a, b USING OLD, NEW;
        IF a IS DISTINCT FROM b THEN changed := true; EXIT; END IF;
      END LOOP;
      IF NOT changed THEN RETURN NEW; END IF;
    END;
  END IF;
  IF period_is_closed(org, new_date) OR period_is_closed(org, old_date) THEN
    RAISE EXCEPTION 'PERIOD_CLOSED: % falls in a closed accounting period', COALESCE(new_date, old_date)
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_txn_period_guard BEFORE INSERT OR UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION guard_closed_period(
    'txn_date', 'txn_date', 'amount', 'amount_twd', 'currency', 'type', 'book', 'category_id',
    'from_account_id', 'to_account_id', 'invoice_id', 'related_to_id', 'settle_employee_id', 'party_id', 'deleted_at');
CREATE TRIGGER trg_invoice_period_guard BEFORE INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_closed_period(
    'invoice_date', 'invoice_date', 'direction', 'status', 'amount_net', 'tax', 'amount_gross', 'currency', 'deleted_at');
CREATE TRIGGER trg_je_period_guard BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION guard_closed_period('entry_date', 'entry_date', 'ledger', 'deleted_at');
CREATE TRIGGER trg_fa_period_guard BEFORE INSERT OR UPDATE OR DELETE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION guard_closed_period(
    'acquired_on', 'acquired_on', 'cost', 'salvage_value', 'useful_life_months', 'asset_account_id', 'source_transaction_id', 'deleted_at');
