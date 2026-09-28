-- 0027: Simpany 薪資申報（唯讀同步）+ 欠薪對帳。
--
-- Simpany 除了電子發票，也是公司申報薪資（扣繳、勞健保）的地方。這裡把它的「薪資申報」
-- 表單**唯讀**拉回來（src/lib/integrations/simpany.ts 的 listSalaryMonthlyForms /
-- getSalaryForm，只允許 GET + 路徑白名單），存成兩張表，再拿去和本系統實際發出的薪資
-- （payslips + 薪資費用交易）對帳，算出每位員工每個月還欠多少（src/lib/simpany-salary.ts）。
--
-- 為什麼是兩張表而不是在明細表塞「這個月沒有表單」的哨兵列：
--   「某月沒建表單」「表單建了但沒人申報」「已申報」是**月份層級**的事實，和員工無關；
--   硬塞進 (org, year, month, simpany_employee_id) 唯一鍵的表裡就得用 NULL 員工當哨兵，
--   唯一索引、查詢、FK 都會變醜。所以：
--     simpany_salary_forms         一個月一列（Simpany 的 monthly-forms 12 格都存），
--                                  simpany_form_id NULL = 那個月沒建表單（UI 顯示「未建立」）。
--     simpany_salary_declarations  一位員工一個月一列（只有表單存在的月份才有）。
--   沒有 forms 列的月份 = 從來沒同步過。
--
-- ⚠️ 個資：Simpany 的回應裡有身分證字號、戶籍地址、國籍 —— **一律不存**（解析時就丟掉，
-- 不進 DB、不進 log、不進任何回傳值）。這裡只有姓名、Simpany 員工 id、金額、日期、旗標。
-- items 只存 { name, type, amount }，不存 Simpany 的 note。
--
-- Forward-only，全部 additive。Run AFTER 0026。

CREATE TABLE simpany_salary_forms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  -- NULL = Simpany 那個月沒有建立薪資申報表單
  simpany_form_id bigint,
  payday date,
  is_settled boolean NOT NULL DEFAULT false,
  -- 表單上的員工數 / 其中真的有申報明細的人數（0 = 表單空白）
  employee_count integer NOT NULL DEFAULT 0,
  filed_count integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_simpany_salary_form UNIQUE (organization_id, year, month),
  CONSTRAINT chk_simpany_salary_form_month CHECK (month BETWEEN 1 AND 12)
);

COMMENT ON TABLE simpany_salary_forms IS 'Simpany 薪資申報的月份狀態（唯讀同步）；simpany_form_id NULL = 那個月沒建表單';
COMMENT ON COLUMN simpany_salary_forms.month IS '薪資所屬月份（Simpany yearMonth），不是發薪日的月份';
COMMENT ON COLUMN simpany_salary_forms.payday IS 'Simpany 表單上的發薪日（通常是次月 5 日）';
COMMENT ON COLUMN simpany_salary_forms.is_settled IS 'Simpany isSettled：已結算 / 已申報';
COMMENT ON COLUMN simpany_salary_forms.filed_count IS '表單上有申報明細（salaryDeclarationItems）的員工數；0 且 employee_count > 0 = 表單空白';

CREATE TABLE simpany_salary_declarations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  simpany_form_id bigint,
  payday date,
  is_settled boolean NOT NULL DEFAULT false,
  simpany_employee_id bigint NOT NULL,
  employee_name text NOT NULL,
  -- 本系統的員工：同組織、姓名完全相同才綁；對不到就 NULL
  employee_id bigint REFERENCES employees(id) ON DELETE SET NULL,
  is_company_owner boolean NOT NULL DEFAULT false,
  base_salary numeric(18,2),
  bonus numeric(18,2),
  gross_declared numeric(18,2),
  net_pay numeric(18,2),
  labor_ins_personal numeric(18,2),
  health_ins_personal numeric(18,2),
  labor_ins_company numeric(18,2),
  health_ins_company numeric(18,2),
  employment_ins_company numeric(18,2),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  filed boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_simpany_salary_decl UNIQUE (organization_id, year, month, simpany_employee_id),
  CONSTRAINT chk_simpany_salary_decl_month CHECK (month BETWEEN 1 AND 12)
);

CREATE INDEX idx_simpany_salary_decl_employee ON simpany_salary_declarations (employee_id)
  WHERE employee_id IS NOT NULL;

COMMENT ON TABLE simpany_salary_declarations IS 'Simpany 薪資申報明細（唯讀同步），一位員工一個月一列；不含身分證字號 / 地址 / 國籍';
COMMENT ON COLUMN simpany_salary_declarations.employee_id IS '本系統 employees.id；同組織姓名完全相同才綁，否則 NULL';
COMMENT ON COLUMN simpany_salary_declarations.base_salary IS '本薪';
COMMENT ON COLUMN simpany_salary_declarations.bonus IS '非經常性薪資（獎金）';
COMMENT ON COLUMN simpany_salary_declarations.gross_declared IS '實際申報薪資（應發總額）';
COMMENT ON COLUMN simpany_salary_declarations.net_pay IS '實際發薪（扣除個人負擔勞健保、扣繳後的實發）';
COMMENT ON COLUMN simpany_salary_declarations.items IS 'Simpany salaryDeclarationItems 去識別化：[{ name, type, amount }]';
COMMENT ON COLUMN simpany_salary_declarations.filed IS 'true = 這位員工這個月有申報明細；false = 表單上有人但沒申報';
