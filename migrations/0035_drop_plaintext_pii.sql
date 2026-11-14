-- 0035: 移除員工的明文個資欄位 employees.national_id / employees.salary_account。
--
-- 背景：0024 加了加密欄位（national_id_enc、employee_bank_accounts.account_number_enc），
-- 程式從那時起只寫密文；既有明文由 scripts/migrate-employee-pii.ts 搬進加密欄位並清空。
-- 欄位留著，資料庫備份、唯讀查詢、DB 外流時就還可能帶出明文，所以搬完就刪。
--
-- ⚠️ 執行前：
--   1. 先部署不再讀這兩欄的程式碼（本次 commit 起 src/db/schema.ts 已沒有它們）。
--      舊版程式的 select 會帶到這兩欄，先刪欄再部署會讓員工頁、MCP 壞掉。
--   2. 跑 `bun run scripts/migrate-employee-pii.ts --apply`，直到 dry run 顯示沒有剩下的列
--      （needsReview / missingOrg 要先人工處理）。
-- 下面的檢查會在還有任何非 NULL 值時整支中止，不會刪掉還沒搬的資料。
-- DROP 刻意寫在同一個 DO 區塊裡：psql 預設不會在錯誤時停下（沒有 ON_ERROR_STOP），
-- 如果 DROP 是區塊外的獨立語句，檢查丟出例外之後它照樣會被執行。
--
-- Forward-only，破壞性（drop column）。Run AFTER 0034。

DO $$
DECLARE
  remaining_national_id bigint;
  remaining_salary_account bigint;
BEGIN
  SELECT count(*) INTO remaining_national_id FROM employees WHERE national_id IS NOT NULL;
  SELECT count(*) INTO remaining_salary_account FROM employees WHERE salary_account IS NOT NULL;
  IF remaining_national_id > 0 OR remaining_salary_account > 0 THEN
    RAISE EXCEPTION
      'employees still has plaintext PII (national_id: %, salary_account: %). Run scripts/migrate-employee-pii.ts --apply first.',
      remaining_national_id, remaining_salary_account;
  END IF;
  ALTER TABLE employees DROP COLUMN IF EXISTS national_id;
  ALTER TABLE employees DROP COLUMN IF EXISTS salary_account;
END
$$;
