-- Link transactions to a contract so collection progress (已收/未收) can be
-- tracked per contract. Mirrors the project_id tag (0003): a transaction still
-- carries party_id (客戶/廠商) AND optionally contract_id. Forward-only, additive.
--
-- A linked income transaction counts as 已收 toward the contract amount; linked
-- expense/advance transactions are cost-only (做這單花了多少) and do NOT reduce
-- the contract amount — profit/loss is computed separately. Run AFTER
-- 0008_contract_file_url.sql.
ALTER TABLE transactions ADD COLUMN contract_id bigint REFERENCES contracts(id);
CREATE INDEX idx_txn_contract ON transactions(contract_id);
