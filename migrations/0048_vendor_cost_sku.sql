-- 0048: 雲端費用明細細到 SKU 與 GKE cluster，另存原價。
--
-- 廠商計費頁的「花費明細」要回答「GCP 每月的錢花在哪」。0037 之前只存到 月 × 專案 × 服務，
-- 派斯所有用量都在同一個專案，Compute Engine 一行 4,596 美元看不出是哪種機器、哪座 cluster。
--
-- - sku          GCP sku.description（例：Nvidia L4 GPU running in Americas）；Azure 與舊列為 ''。
-- - cluster      GKE cluster 名稱（goog-k8s-cluster-name 標籤）；沒有為 ''。
-- - list_amount  原價 = 還沒扣任何 credits 的 cost。gross_amount 已經扣了免費額度與折扣，
--                跟 Cloud Console 的「費用」對不上（例：GKE 免費額度每月 74.40 美元）。
--                NULL（舊列、Azure）視同 gross_amount。
--
-- 唯一鍵加上 sku、cluster。既有的舊列 sku = cluster = ''，鍵不衝突；GCP 下次同步會從最早一個
-- 還沒有 SKU 的月份重抓，寫入新列後把同月份的舊列刪掉（src/lib/vendor-billing/sync.ts）。
--
-- Forward-only，additive（只換唯一鍵）。Run AFTER 0047。

ALTER TABLE vendor_cost_lines ADD COLUMN sku text NOT NULL DEFAULT '';
ALTER TABLE vendor_cost_lines ADD COLUMN cluster text NOT NULL DEFAULT '';
ALTER TABLE vendor_cost_lines ADD COLUMN list_amount numeric(18, 4);

ALTER TABLE vendor_cost_lines DROP CONSTRAINT uq_vendor_cost_line;
ALTER TABLE vendor_cost_lines ADD CONSTRAINT uq_vendor_cost_line
  UNIQUE (billing_account_id, month, resource_external_id, service, sku, cluster, source);

COMMENT ON COLUMN vendor_cost_lines.sku IS 'GCP sku.description；Azure 與 0048 前的舊列為空字串';
COMMENT ON COLUMN vendor_cost_lines.cluster IS 'GKE cluster（goog-k8s-cluster-name 標籤）；沒有為空字串';
COMMENT ON COLUMN vendor_cost_lines.list_amount IS '原價 = 未扣任何 credits 的 cost；NULL 視同 gross_amount';
