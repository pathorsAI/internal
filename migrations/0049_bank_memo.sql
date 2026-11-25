-- 0049: 銀行備註與參考號 + 銀行對帳單匯入紀錄（src/lib/bank-import、src/db/bank-import.ts）。
--
-- 問題：447 筆永豐（SinoPac）交易是手動／AI 建的，銀行明細上的「備註」與「交易序號」一個都沒留，
-- 之後對帳根本不知道哪一筆對哪一筆。
--
-- transactions.bank_memo  銀行自己的備註原文（對帳單的 Remarks、Wise 的 reference）。
--                         跟 description（人寫的摘要）分開，永遠不會覆蓋 description。
-- transactions.bank_ref   銀行的交易參考號（例如 6NBBJFT300RD4TM、Wise 的 referenceNumber）。
--                         不設唯一：同一個參考號可能拆成好幾筆帳（例如手續費另記）。
--
-- bank_statement_lines   匯入過的對帳單明細，一行一列，用 line_hash 去重（同一份檔案重匯不會重複）。
--   line_hash       sha256(組織, 帳號末四碼, 交易時間, 提款, 存款, 餘額, 參考號, 備註)，見 src/lib/bank-import/sinopac.ts
--   status          matched          對到既有交易，補上 bank_memo / bank_ref
--                   created          沒對到，新建一筆待確認交易
--                   correction_pair  沖正（Correction）與被沖正的那一行，兩行互相抵銷，不建也不對交易
--                   skipped          略過（例如沖正找不到原交易、寫入失敗），原因在 note
--   transaction_id  對到或新建的交易；交易被硬刪時變 NULL（軟刪除不影響）
--
-- 新欄位不需要額外處理復原（0045）：trg_entity_change 存的是整列 to_jsonb，自動含新欄位。
-- 0044 的結帳鎖定（guard_closed_period）只看會影響帳的欄位，補 bank_memo / bank_ref 不會被擋。
-- bank_statement_lines 刻意不掛 0045 的 trigger：它是匯入紀錄，不是使用者會「復原」的資料。
--
-- Forward-only，全部 additive。Run AFTER 0048（0048 是另一個 PR 的 migration）。

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_memo text;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_ref text;

CREATE INDEX IF NOT EXISTS idx_txn_bank_ref ON transactions (organization_id, bank_ref)
  WHERE bank_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL,
  bank_account_id bigint NOT NULL REFERENCES bank_accounts(id),
  line_hash text NOT NULL,
  txn_at timestamptz NOT NULL,
  currency char(3) NOT NULL,
  withdrawal numeric(18,2),
  deposit numeric(18,2),
  balance numeric(18,2),
  bank_ref text,
  remarks text,
  is_correction boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  note text,
  transaction_id bigint REFERENCES transactions(id) ON DELETE SET NULL,
  imported_by_user_id text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_bank_statement_line UNIQUE (organization_id, line_hash),
  CONSTRAINT chk_bsl_status CHECK (status = ANY (ARRAY['matched', 'created', 'correction_pair', 'skipped']))
);

-- 「這筆交易已經被哪一行對帳單認領」要查（比對時排除已認領的交易）。
CREATE INDEX IF NOT EXISTS idx_bsl_transaction ON bank_statement_lines (organization_id, transaction_id)
  WHERE transaction_id IS NOT NULL;
