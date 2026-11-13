-- 0034: 代墊／應付未還可以記給「公司」（交易對象 party），不只員工。
--
-- 問題：type='advance' 只能用 settle_employee_id 結算給員工。關係企業幫我們墊的錢（例如東蜂替派斯
-- 墊付 Groq、LiveKit、Twilio）沒地方記：填員工名稱會在 employees 建出一個假員工；記成發票或支出
-- 又會跟真的開票資料、付款帳戶混在一起。docs/ledger-v2-design.md §6 原本就設計成 settle_party_id，
-- 這支把它補上，跟 settle_employee_id 並存。
--
-- - settle_party_id   代墊人是公司時填這欄（指向 parties）。advance 與它的 reimbursement 都帶同一個值，
--                     跟 settle_employee_id 二擇一（chk_txn_settle_one：兩個不能同時有值）。
--                     既有列都是員工代墊或根本沒有代墊人，settle_party_id 一律 NULL，不違反約束。
--
-- 未還清單（listOutstandingAdvances）、記錄撥款（createReimbursement / MCP create_reimbursement）
-- 同時看兩欄；公司沒有員工銀行帳戶，撥款的 settle_to_account_id 一律留空。
--
-- ⚠️ 部署順序：先跑這支 migration 再部署程式碼。交易列表、未還清單、MCP 都會 select / join 這一欄，
-- 欄位不存在時交易頁、代墊頁與 MCP 都會壞。舊程式碼不認得這欄，先跑 migration 不影響現行版本。
--
-- Forward-only，全部 additive（nullable 欄位 + FK + 索引 + CHECK）。Run AFTER 0033。

ALTER TABLE transactions
  ADD COLUMN settle_party_id bigint CONSTRAINT transactions_settle_party_id_fkey REFERENCES parties(id);

CREATE INDEX IF NOT EXISTS idx_txn_settle_party ON transactions(settle_party_id);

ALTER TABLE transactions
  ADD CONSTRAINT chk_txn_settle_one CHECK (settle_employee_id IS NULL OR settle_party_id IS NULL);
