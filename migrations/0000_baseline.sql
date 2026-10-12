-- 0000: baseline —— migrations/ 開始之前就已經存在的業務表。
--
-- 為什麼有這支：production 的這些表是在 migrations/ 這個資料夾出現之前建的，所以從 0001 起
-- 每支 migration 都假設它們已經存在（0002 一開頭就是 ALTER TABLE categories …）。照
-- docs/deployment.md 把 migrations/*.sql 依序灌進一個空資料庫時，會在 0002 直接失敗。
--
-- 內容：src/db/schema.ts 在第一個 commit（34ef736）時的樣子，扣掉之後由 0002 / 0003 加上的
-- 部分（各表的 organization_id、transactions.project_id、以組織為單位的 parties_name_key）。
-- 序列、constraint、index 名稱沿用 production 的實際名稱（例如 parties 的序列仍叫
-- suppliers_id_seq），後面的 migration 才對得上。
--
-- 冪等：全部 CREATE … IF NOT EXISTS。對已經有這些表的 production 是 no-op，
-- 所以重跑整個 migrations/ 也不會出事；只有空資料庫會真的建表。
--
-- 驗證方式（2026-10-12）：在空的 Neon 資料庫依序套 0000 → 最新，與 production 的
-- pg_dump --schema-only 比對（見 PR 說明）。

CREATE TABLE IF NOT EXISTS categories (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME categories_id_seq) PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT chk_category_kind CHECK (kind = ANY (ARRAY['income','cogs','expense','non_operating','transfer','equity']))
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME bank_accounts_id_seq) PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  currency char(3) NOT NULL,
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoices (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME invoices_id_seq) PRIMARY KEY,
  direction text NOT NULL,
  invoice_number text,
  invoice_date date,
  counterparty_name text,
  counterparty_tax_id text,
  amount_net numeric(18,2),
  tax numeric(18,2),
  amount_gross numeric(18,2),
  currency char(3) NOT NULL DEFAULT 'TWD',
  status text NOT NULL DEFAULT 'valid',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_invoice_direction CHECK (direction = ANY (ARRAY['issued','received'])),
  CONSTRAINT chk_invoice_status CHECK (status = ANY (ARRAY['valid','void','allowance']))
);
CREATE TABLE IF NOT EXISTS employees (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME employees_id_seq) PRIMARY KEY,
  name text NOT NULL,
  national_id text,
  employment_type text NOT NULL DEFAULT 'full_time',
  has_labor_insurance boolean NOT NULL DEFAULT true,
  has_health_insurance boolean NOT NULL DEFAULT true,
  has_pension boolean NOT NULL DEFAULT true,
  base_salary numeric(18,2),
  labor_insured_salary numeric(18,2),
  health_insured_salary numeric(18,2),
  salary_account text,
  start_date date,
  end_date date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_emp_type CHECK (employment_type = ANY (ARRAY['full_time','part_time','freelancer','contractor']))
);
CREATE TABLE IF NOT EXISTS payroll_runs (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME payroll_runs_id_seq) PRIMARY KEY,
  period_year integer NOT NULL,
  period_month integer NOT NULL,
  pay_date date,
  status text NOT NULL DEFAULT 'draft',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_run_period UNIQUE (period_year, period_month),
  CONSTRAINT chk_run_status CHECK (status = ANY (ARRAY['draft','finalized','paid']))
);
CREATE TABLE IF NOT EXISTS payroll_item_types (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME payroll_item_types_id_seq) PRIMARY KEY,
  name text NOT NULL,
  direction text NOT NULL,
  is_taxable boolean NOT NULL,
  is_statutory boolean NOT NULL DEFAULT false,
  note text,
  CONSTRAINT chk_pit_direction CHECK (direction = ANY (ARRAY['earning','deduction']))
);
CREATE TABLE IF NOT EXISTS parties (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME suppliers_id_seq) PRIMARY KEY,
  name text NOT NULL,
  label text NOT NULL DEFAULT 'vendor',
  tax_id text,
  default_currency char(3),
  default_account_id bigint CONSTRAINT suppliers_default_account_id_fkey REFERENCES bank_accounts(id),
  typical_amount numeric(18,2),
  contact text,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_supplier_type CHECK (label = ANY (ARRAY['vendor','customer','gov','other'])),
  CONSTRAINT parties_name_key UNIQUE (name)
);
CREATE TABLE IF NOT EXISTS transactions (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME transactions_id_seq) PRIMARY KEY,
  txn_date date NOT NULL,
  description text,
  category_id bigint CONSTRAINT transactions_category_id_fkey REFERENCES categories(id),
  amount numeric(18,2) NOT NULL,
  currency char(3) NOT NULL,
  original_amount numeric(18,2),
  original_currency char(3),
  fx_rate numeric(18,8),
  amount_twd numeric(18,2),
  from_account_id bigint CONSTRAINT transactions_from_account_id_fkey REFERENCES bank_accounts(id),
  to_account_id bigint CONSTRAINT transactions_to_account_id_fkey REFERENCES bank_accounts(id),
  transfer_group_id bigint,
  book text NOT NULL DEFAULT 'both',
  invoice_id bigint CONSTRAINT transactions_invoice_id_fkey REFERENCES invoices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  billed_to_company_tax_id boolean NOT NULL DEFAULT false,
  party_id bigint CONSTRAINT transactions_supplier_id_fkey REFERENCES parties(id),
  settle_employee_id bigint CONSTRAINT transactions_settle_employee_id_fkey REFERENCES employees(id),
  related_to_id bigint CONSTRAINT transactions_related_to_id_fkey REFERENCES transactions(id),
  type text NOT NULL DEFAULT 'expense',
  CONSTRAINT chk_txn_book CHECK (book = ANY (ARRAY['both','internal','external'])),
  CONSTRAINT chk_txn_type CHECK (type = ANY (ARRAY['expense','income','advance','reimbursement','transfer']))
);
CREATE INDEX IF NOT EXISTS idx_txn_book ON transactions(book);
CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(txn_date);
CREATE INDEX IF NOT EXISTS idx_txn_from ON transactions(from_account_id);
CREATE INDEX IF NOT EXISTS idx_txn_supplier ON transactions(party_id);
CREATE INDEX IF NOT EXISTS idx_txn_to ON transactions(to_account_id);
CREATE INDEX IF NOT EXISTS idx_txn_settle ON transactions(settle_employee_id);
CREATE INDEX IF NOT EXISTS idx_txn_related ON transactions(related_to_id);
CREATE TABLE IF NOT EXISTS payslips (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME payslips_id_seq) PRIMARY KEY,
  payroll_run_id bigint NOT NULL CONSTRAINT payslips_payroll_run_id_fkey REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id bigint NOT NULL CONSTRAINT payslips_employee_id_fkey REFERENCES employees(id),
  taxable_total numeric(18,2) NOT NULL DEFAULT 0,
  nontaxable_total numeric(18,2) NOT NULL DEFAULT 0,
  deduction_total numeric(18,2) NOT NULL DEFAULT 0,
  net_pay numeric(18,2) NOT NULL DEFAULT 0,
  paid_transaction_id bigint CONSTRAINT payslips_paid_transaction_id_fkey REFERENCES transactions(id),
  note text,
  CONSTRAINT uq_payslip UNIQUE (payroll_run_id, employee_id)
);
CREATE TABLE IF NOT EXISTS payslip_items (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME payslip_items_id_seq) PRIMARY KEY,
  payslip_id bigint NOT NULL CONSTRAINT payslip_items_payslip_id_fkey REFERENCES payslips(id) ON DELETE CASCADE,
  item_type_id bigint CONSTRAINT payslip_items_item_type_id_fkey REFERENCES payroll_item_types(id),
  name text NOT NULL,
  direction text NOT NULL,
  is_taxable boolean NOT NULL,
  amount numeric(18,2) NOT NULL,
  hours numeric(8,2),
  CONSTRAINT chk_psitem_direction CHECK (direction = ANY (ARRAY['earning','deduction']))
);
CREATE TABLE IF NOT EXISTS account_reconciliations (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME account_reconciliations_id_seq) PRIMARY KEY,
  account_id bigint NOT NULL CONSTRAINT account_reconciliations_account_id_fkey REFERENCES bank_accounts(id),
  as_of_date date NOT NULL,
  statement_balance numeric(18,2) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_recon_account_date UNIQUE (account_id, as_of_date)
);
CREATE TABLE IF NOT EXISTS documents (
  id bigint GENERATED ALWAYS AS IDENTITY (SEQUENCE NAME documents_id_seq) PRIMARY KEY,
  doc_type text NOT NULL,
  r2_key text NOT NULL CONSTRAINT documents_r2_key_key UNIQUE,
  file_name text,
  content_type text,
  size_bytes bigint,
  transaction_id bigint CONSTRAINT documents_transaction_id_fkey REFERENCES transactions(id) ON DELETE SET NULL,
  invoice_id bigint CONSTRAINT documents_invoice_id_fkey REFERENCES invoices(id) ON DELETE SET NULL,
  period_label text,
  note text,
  invoice_kind text,
  accountant_notified_at timestamptz,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_doc_type CHECK (doc_type = ANY (ARRAY['receipt','invoice','vat_return_401','withholding','payroll','contract','other'])),
  CONSTRAINT chk_doc_invoice_kind CHECK (invoice_kind IS NULL OR invoice_kind = ANY (ARRAY['electronic','paper']))
);
CREATE INDEX IF NOT EXISTS idx_doc_txn ON documents(transaction_id);
CREATE INDEX IF NOT EXISTS idx_doc_invoice ON documents(invoice_id);
