-- 0029: Simpany 薪資申報寫入（準備 → 寫入 → 結算 → 寄薪資單）的草稿表。
--
-- 0027 把 Simpany 的薪資申報唯讀拉回來對帳；這一版讓 owner / admin 從本系統（web 薪資頁、MCP）
-- 直接在 Simpany 填寫每月薪資申報，不用再到 Simpany 的介面一格一格點。流程與電子發票開立
-- （0025 invoice_drafts）一樣是兩段式（src/lib/simpany-payroll.ts）：
--
--   1. prepareSalaryFiling —— 讀 Simpany 的表單與每位員工的申報明細當模板，換上這個月的日期與
--      金額，呼叫 Simpany 的試算（calculate，不存檔），把「要 PUT 給 Simpany 的每一份 body」原樣
--      存成一筆草稿，回傳每人應發 / 個人負擔 / 公司負擔 / 扣繳 / 實發給使用者確認。
--   2. applySalaryFiling(draftId) —— 使用者確認後，才把草稿裡的 body 原封不動寫進 Simpany
--      （PUT 申報明細、PATCH 發薪日、負責人旗標），再讀回來比對實發。寫入只接受 draft id。
--   結算（settle，送給記帳士）與寄薪資單是另外兩步，各自要使用者明確確認，不綁草稿。
--
-- 狀態：pending（可寫入）→ applied（已寫入 Simpany）→ settled（該月已結算）；
--       cancelled（使用者取消 / 表單已變動）、expired（超過 2 小時沒寫入）。
-- 寫入的每一步都是覆寫式（PUT / PATCH），失敗時草稿退回 pending，apply_result 記下已寫入哪些人。
--
-- ⚠️ 個資：payload 只有 Simpany 申報明細的白名單欄位（日期、投保旗標、扶養人數、項目 itemId /
-- 名稱 / 金額 / 備註）與姓名、Simpany 員工 id —— 沒有身分證字號、地址、國籍。
--
-- Forward-only，全部 additive。Run AFTER 0028。

CREATE TABLE simpany_salary_drafts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  -- 薪資所屬月份（不是發薪日的月份）
  year integer NOT NULL,
  month integer NOT NULL,
  simpany_form_id bigint NOT NULL,
  -- 要寫進 Simpany 的發薪日（慣例：次月 5 日）
  payday date NOT NULL,
  -- { declarations: [{ declarationId, simpanyEmployeeId, name, isCompanyOwner, ownerFlagChange, body }],
  --   companyOwner }；body = PUT form/{formId}/salary-declaration/{declId} 的原樣內容
  payload jsonb NOT NULL,
  -- 給人看的預覽：每人應發 / 個人負擔 / 公司負擔 / 扣繳 / 實發、投保級距、警示、順序限制
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 寫入結果：written（已寫入的人）、failedStep、error、verification（讀回來的實發比對）
  apply_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  settled_at timestamptz,
  CONSTRAINT chk_simpany_salary_draft_status
    CHECK (status = ANY (ARRAY['pending'::text, 'applied'::text, 'settled'::text, 'cancelled'::text, 'expired'::text])),
  CONSTRAINT chk_simpany_salary_draft_month CHECK (month BETWEEN 1 AND 12)
);

CREATE INDEX idx_simpany_salary_draft_org_month
  ON simpany_salary_drafts (organization_id, year, month, created_at DESC);

COMMENT ON TABLE simpany_salary_drafts IS 'Simpany 薪資申報寫入前的預覽草稿；寫入只接受 draft id（看過的 = 送出的），2 小時過期';
COMMENT ON COLUMN simpany_salary_drafts.payload IS '{ declarations[{ declarationId, simpanyEmployeeId, name, isCompanyOwner, ownerFlagChange, body }], companyOwner }：body 原樣 PUT 給 Simpany';
COMMENT ON COLUMN simpany_salary_drafts.status IS 'pending / applied（已寫入 Simpany）/ settled（該月已結算）/ cancelled / expired';
COMMENT ON COLUMN simpany_salary_drafts.apply_result IS '寫入結果：written、failedStep、error、verification';
