-- 0013: 交易綁定訂閱與「某一期」，用來對帳週期性收款哪一期已收/未收。
-- subscription_period = 該期的起始日（period start）。income 交易計入該期已收。
ALTER TABLE transactions
  ADD COLUMN subscription_id bigint,
  ADD COLUMN subscription_period date;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_subscription_id_fkey
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id);
CREATE INDEX idx_txn_subscription ON transactions USING btree (subscription_id);
