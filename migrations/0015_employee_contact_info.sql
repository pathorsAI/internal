-- 0015: 員工基本聯絡資訊（工作/聯絡 email、電話、備註）+ 選填綁定登入使用者。
-- user_id 可為 NULL：有些員工只是名冊紀錄、不會登入系統，不強制 1:1。
-- 同一個 user 在同一個 org 內最多綁一位（未刪除的）員工。
ALTER TABLE employees
  ADD COLUMN work_email text,
  ADD COLUMN personal_email text,
  ADD COLUMN phone text,
  ADD COLUMN note text,
  ADD COLUMN user_id text;
ALTER TABLE employees
  ADD CONSTRAINT employees_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX uq_employee_user ON employees (organization_id, user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;
