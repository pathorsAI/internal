-- 0014: 每期「應收金額」覆寫。讓同一張訂閱不同期別可有不同應收（例如過渡期只收 2 個月）。
CREATE TABLE subscription_periods (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text,
  subscription_id bigint NOT NULL,
  period_start date NOT NULL,
  expected_amount numeric(18,2) NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
ALTER TABLE subscription_periods
  ADD CONSTRAINT subscription_periods_subscription_id_fkey
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id);
CREATE UNIQUE INDEX uq_subscription_period ON subscription_periods (subscription_id, period_start) WHERE deleted_at IS NULL;
CREATE INDEX idx_subscription_period_sub ON subscription_periods (subscription_id);
