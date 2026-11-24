-- 0041: 收款分配 —— 一筆入帳分給多個應收，並記下吸收的手續費／匯差。
--
-- 問題：一筆入帳只能綁一個目標（transactions.contract_id／subscription_id＋subscription_period／
-- billing_item_id）。客戶常把整張請款單（月費＋用量＋建置分期）一次匯過來，又被扣掉匯款手續費，
-- 結果要嘛只能綁其中一項、其他項目永遠「待收」，要嘛綁了也因為差幾塊錢永遠「部分收款」。
--
-- payment_allocations：一列 = 這筆入帳分給某一個應收的金額。
--   target_type = 'subscription_period'  subscription_id + subscription_period（該期起始日）
--               = 'billing_item'         billing_item_id
--               = 'contract'             contract_id（直接記在合約上，沒有對應的分期時用）
--   amount      這筆入帳分給它的實收金額（同幣別）。同一筆交易所有分配的 amount 加總 ≤ 交易金額（程式端檢查）。
--   fee         這個應收被吸收掉的手續費／匯差（例如匯款被扣 6.21）：不是錢，是「我們同意少收」，
--               收齊判斷用 amount + fee 去比應收；管理帳報表加總 fee 就是吸收的手續費總額。不會產生交易。
--
-- 收齊判斷（src/lib/payment-allocation.ts）：
--   - 交易有任何分配列 → 只看分配列，忽略它舊的單一綁定欄位；
--   - 交易沒有分配列 → 照舊用單一綁定欄位，視為「整筆分配給那個目標」。
-- 所以舊資料不用搬：分配列只在有人真的拆分一筆入帳時才出現，其餘交易照舊讀單一綁定（src/db/allocations.ts
-- 用 NOT EXISTS 把兩種來源合在一起）。舊欄位不刪（向下相容、也是手寫 SQL 查帳的人熟悉的欄位）。
--
-- 合約的已收 = 直接分配給合約 + 分配給它底下請款項目 + 分配給它底下訂閱期別（綁了 contract_id 的）。
--
-- Forward-only，additive。Run AFTER 0040。

CREATE TABLE payment_allocations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  transaction_id bigint NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  subscription_id bigint REFERENCES subscriptions(id) ON DELETE CASCADE,
  subscription_period date,
  billing_item_id bigint REFERENCES billing_items(id) ON DELETE CASCADE,
  contract_id bigint REFERENCES contracts(id) ON DELETE CASCADE,
  amount numeric(18, 2) NOT NULL,
  fee numeric(18, 2) NOT NULL DEFAULT 0,
  note text,
  created_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_allocation_target CHECK (
    (target_type = 'subscription_period' AND subscription_id IS NOT NULL AND subscription_period IS NOT NULL
       AND billing_item_id IS NULL AND contract_id IS NULL)
    OR (target_type = 'billing_item' AND billing_item_id IS NOT NULL
       AND subscription_id IS NULL AND subscription_period IS NULL AND contract_id IS NULL)
    OR (target_type = 'contract' AND contract_id IS NOT NULL
       AND subscription_id IS NULL AND subscription_period IS NULL AND billing_item_id IS NULL)
  ),
  CONSTRAINT chk_allocation_amounts CHECK (amount >= 0 AND fee >= 0 AND amount + fee > 0)
);

CREATE INDEX idx_allocation_txn ON payment_allocations (transaction_id);
CREATE INDEX idx_allocation_sub ON payment_allocations (subscription_id, subscription_period) WHERE subscription_id IS NOT NULL;
CREATE INDEX idx_allocation_item ON payment_allocations (billing_item_id) WHERE billing_item_id IS NOT NULL;
CREATE INDEX idx_allocation_contract ON payment_allocations (contract_id) WHERE contract_id IS NOT NULL;
CREATE INDEX idx_allocation_org ON payment_allocations (organization_id);
