-- 0024: 員工多帳戶（薪轉 / 報銷撥款的收款帳戶）+ 身分證字號加密欄位。
--
-- 問題：employees.salary_account 是一格自由文字，一位員工只能記一個帳戶，而且
-- 帳號與身分證字號都以明文存在資料庫裡；遮罩只發生在 MCP 的輸出層，網頁端任何
-- 組織成員都拿得到完整值。發薪與撥款也無從記錄「錢匯到員工的哪個帳戶」。
--
-- 做法：
-- (1) 新表 employee_bank_accounts：一位員工可有多個帳戶。帳號本體只存密文
--     （src/lib/crypto.ts 的 encryptField，AES-256-GCM，金鑰為部署 secret
--     FIELD_ENCRYPTION_KEY），另存末 5 碼供列表與遮罩顯示，不需解密。
--     「薪資預設 / 報銷預設」各自以 partial unique index 保證同一位員工最多一個。
-- (2) payslips.paid_to_account_id、transactions.settle_to_account_id：記錄這筆
--     薪資 / 撥款匯入員工的哪個帳戶（選填）。與既有的 from_account_id（公司自己的
--     帳本帳戶 bank_accounts）是兩回事，互不取代。
-- (3) employees.national_id_enc：身分證字號的密文。寫入時改寫這欄並清空明文
--     national_id；讀取時優先讀密文，沒有才退回舊的明文欄位。
--
-- 舊欄位（national_id / salary_account）本次不刪：既有資料的搬移由
-- scripts/migrate-employee-pii.ts 另外執行（需要加密金鑰，SQL 做不到），確認
-- 搬完之後再用後續 migration 移除。Forward-only，全部 additive。
-- Run AFTER 0023.

-- (1) 員工收款帳戶
-- kind：
--   bank   台灣的銀行 / 郵局帳戶，bank_code 必填（3 碼），帳號只能是數字
--   wise   Wise 等跨境收款帳戶
--   other  其他（無法歸類的舊資料也放這裡）
CREATE TABLE employee_bank_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text,
  employee_id bigint NOT NULL REFERENCES employees(id),
  kind text NOT NULL DEFAULT 'bank',
  bank_code text,
  branch_code text,
  bank_name text,
  account_holder text,
  account_number_enc text NOT NULL,
  account_last5 text NOT NULL,
  currency text NOT NULL DEFAULT 'TWD',
  label text,
  default_for_salary boolean NOT NULL DEFAULT false,
  default_for_reimbursement boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_emp_acct_kind
    CHECK (kind = ANY (ARRAY['bank'::text, 'wise'::text, 'other'::text])),
  -- 銀行帳戶一定要有 3 碼銀行代碼；其他種類可留空，但有填就得是 3 碼數字。
  CONSTRAINT chk_emp_acct_bank_code
    CHECK ((kind <> 'bank' OR bank_code IS NOT NULL) AND (bank_code IS NULL OR bank_code ~ '^[0-9]{3}$')),
  CONSTRAINT chk_emp_acct_branch_code
    CHECK (branch_code IS NULL OR branch_code ~ '^[0-9]{4}$'),
  CONSTRAINT chk_emp_acct_last5
    CHECK (char_length(account_last5) BETWEEN 1 AND 5),
  CONSTRAINT chk_emp_acct_currency
    CHECK (currency ~ '^[A-Z]{3}$')
);

COMMENT ON TABLE employee_bank_accounts IS '員工的收款帳戶（薪轉 / 報銷撥款），一位員工可有多個';
COMMENT ON COLUMN employee_bank_accounts.bank_code IS '銀行代碼 3 碼（例 807 永豐）；kind = bank 時必填';
COMMENT ON COLUMN employee_bank_accounts.branch_code IS '分行代碼 4 碼，選填';
COMMENT ON COLUMN employee_bank_accounts.account_number_enc IS '完整帳號的密文（encryptField，v1:<iv>:<ct>）；明文只在 owner/admin 明確「顯示完整帳號」時於 server 端解密，並寫入 activity_log';
COMMENT ON COLUMN employee_bank_accounts.account_last5 IS '帳號末 5 碼（去掉空白與連字號後），列表與遮罩顯示用，不需解密';
COMMENT ON COLUMN employee_bank_accounts.default_for_salary IS '發薪時預設匯入這個帳戶；同一位員工最多一個';
COMMENT ON COLUMN employee_bank_accounts.default_for_reimbursement IS '報銷撥款時預設匯入這個帳戶；同一位員工最多一個';

CREATE INDEX idx_emp_acct_employee ON employee_bank_accounts (employee_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_emp_acct_org ON employee_bank_accounts (organization_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_emp_acct_default_salary ON employee_bank_accounts (employee_id)
  WHERE default_for_salary AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_emp_acct_default_reimbursement ON employee_bank_accounts (employee_id)
  WHERE default_for_reimbursement AND deleted_at IS NULL;

-- (2) 薪資單 / 交易記錄匯入的員工帳戶
ALTER TABLE payslips ADD COLUMN paid_to_account_id bigint REFERENCES employee_bank_accounts(id);
ALTER TABLE transactions ADD COLUMN settle_to_account_id bigint REFERENCES employee_bank_accounts(id);
CREATE INDEX idx_payslip_paid_to ON payslips (paid_to_account_id);
CREATE INDEX idx_txn_settle_to ON transactions (settle_to_account_id);

COMMENT ON COLUMN payslips.paid_to_account_id IS '薪資匯入的員工帳戶（employee_bank_accounts），選填';
COMMENT ON COLUMN transactions.settle_to_account_id IS '撥款 / 薪資匯入的員工帳戶（employee_bank_accounts），選填；與 from_account_id（公司帳本帳戶）無關';

-- (3) 身分證字號密文
ALTER TABLE employees ADD COLUMN national_id_enc text;

COMMENT ON COLUMN employees.national_id_enc IS '身分證字號 / 統編的密文（encryptField）；讀取時優先於明文 national_id';
COMMENT ON COLUMN employees.national_id IS '已淘汰：明文身分證字號，改存 national_id_enc。scripts/migrate-employee-pii.ts 搬完後清空，後續 migration 移除';
COMMENT ON COLUMN employees.salary_account IS '已淘汰：單一自由文字的薪轉帳戶，改用 employee_bank_accounts。scripts/migrate-employee-pii.ts 搬完後清空，後續 migration 移除';
