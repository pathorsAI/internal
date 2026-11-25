-- 0045: 復原（undo）—— 每一筆資料變動留下前後快照，操作紀錄可以一鍵復原。
--
-- 問題：activity_log 只記「誰、做了什麼、一句說明」，沒有資料可以還原。Demo 時常常是
-- 「記一筆 → 跟 AI 說『復原剛剛那筆』」，現在做不到。
--
-- entity_changes：資料列層級的變動紀錄，由 trigger 寫，app 不直接寫。
--   一列 = 某張表的某一列被 INSERT／UPDATE／DELETE 一次。before／after 是 to_jsonb(OLD／NEW)
--   的完整資料列（含密文欄位的密文——復原要原樣寫回去；這張表只在 server 端讀，畫面一律
--   看 activity_log 上遮罩過的 before／after）。內容完全沒變的 UPDATE 不記。
--   txid 是寫入時的交易 id，查同一個交易裡的連帶變動用。
--
-- record_entity_change()：AFTER INSERT/UPDATE/DELETE FOR EACH ROW 的 trigger function，
--   只掛在「app 會寫、有 bigint id 與 organization_id」的使用者資料表上。下面用 DO 迴圈掛：
--   表不存在（例如 recurring_expenses 已被別支 migration DROP）或少了 id／organization_id
--   欄位就跳過，所以跟 0044 誰先上都能套。
--
-- activity_log 新增：
--   before / after     這筆操作前後的資料（敏感欄位已遮罩，src/lib/undo-snapshot.ts），給畫面看差異。
--   change_id          這筆操作對到的最後一列 entity_changes（復原與衝突判斷以它為準）。
--   first_change_id    同一筆操作對到的第一列 entity_changes（一個操作可能寫同一列好幾次，
--                      復原「修改」要回到第一次之前的樣子）。
--   tool_name          MCP／站內 AI 呼叫的工具名稱（批次、合併、發薪這類一次動很多列的工具
--                      不能復原，要靠它說清楚為什麼）。網頁操作是 NULL。
--   undo_of            這筆是復原哪一筆操作紀錄（復原本身也是一筆普通的變動，可以再復原＝重做）。
--
-- 寫入順序：程式（src/db/activity.ts record()）在寫完資料後才寫 activity_log，回頭找這一列
-- 最近 2 分鐘內、還沒被別的操作紀錄認領的 entity_changes。程式碼比 migration 先上也安全：
-- 欄位不存在時 record() 會退回不帶快照的寫法。
--
-- 不回填：舊的操作紀錄沒有快照，畫面會說「這筆紀錄沒有可復原的資料」。
--
-- 跟 0044 的結帳鎖定並存：guard_closed_period 是 BEFORE trigger，被擋下（PERIOD_CLOSED）的寫入
-- 根本不會走到這裡的 AFTER trigger，所以 entity_changes 不會記到沒發生的變動；這支不動它的 trigger。
-- 復原落在已結帳月份時，程式先用 fiscal_periods 判斷並拒絕（src/lib/undo-rules.ts），
-- 執行時萬一還是撞到 PERIOD_CLOSED，也會轉成看得懂的理由。
--
-- Forward-only，全部 additive。Run AFTER 0044（0044_general_ledger）。

CREATE TABLE entity_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text,
  table_name text NOT NULL,
  row_id bigint NOT NULL,
  op text NOT NULL,
  before jsonb,
  after jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT chk_entity_change_op CHECK (op = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text]))
);

CREATE INDEX idx_entity_changes_row ON entity_changes (table_name, row_id, id);
CREATE INDEX idx_entity_changes_org ON entity_changes (organization_id, id);

CREATE OR REPLACE FUNCTION record_entity_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  src jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_row := to_jsonb(NEW);
    src := new_row;
  ELSIF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    -- 內容完全一樣的 UPDATE（例如重存同一張表單）不算變動。
    IF old_row = new_row THEN
      RETURN NULL;
    END IF;
    src := new_row;
  ELSE
    old_row := to_jsonb(OLD);
    src := old_row;
  END IF;

  INSERT INTO entity_changes (organization_id, table_name, row_id, op, before, after)
  VALUES (
    src ->> 'organization_id',
    TG_TABLE_NAME,
    (src ->> 'id')::bigint,
    lower(TG_OP),
    old_row,
    new_row
  );
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transactions', 'parties', 'categories', 'bank_accounts', 'projects', 'contracts',
    'subscriptions', 'subscription_periods', 'billing_items', 'invoices', 'employees',
    'employee_bank_accounts', 'account_reconciliations', 'recurring_expenses',
    'payment_allocations', 'documents',
    'vendor_billing_accounts', 'payment_methods', 'vendor_invoices', 'ai_rules',
    -- 0044 總帳：分錄（分錄行 journal_lines 沒有 organization_id，跟著分錄走）、財產、會計科目、匯率
    'journal_entries', 'fixed_assets', 'gl_accounts', 'fx_rates'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = t AND column_name = 'id' AND data_type = 'bigint'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = t AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_entity_change ON %I', t);
      EXECUTE format(
        'CREATE TRIGGER trg_entity_change AFTER INSERT OR UPDATE OR DELETE ON %I '
        'FOR EACH ROW EXECUTE FUNCTION record_entity_change()',
        t
      );
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE activity_log
  ADD COLUMN before jsonb,
  ADD COLUMN after jsonb,
  ADD COLUMN change_id bigint REFERENCES entity_changes(id) ON DELETE SET NULL,
  ADD COLUMN first_change_id bigint REFERENCES entity_changes(id) ON DELETE SET NULL,
  ADD COLUMN tool_name text,
  ADD COLUMN undo_of bigint REFERENCES activity_log(id) ON DELETE SET NULL;

-- 「這列 entity_changes 已經被哪筆操作認領了」與「這筆被復原過沒」都要查。
CREATE INDEX idx_activity_change ON activity_log (change_id) WHERE change_id IS NOT NULL;
CREATE INDEX idx_activity_undo_of ON activity_log (undo_of) WHERE undo_of IS NOT NULL;
