-- 0030: 交易對象（廠商 / 客戶）的頭像 / logo。
--
-- 讓使用者替每個交易對象上傳一張小圖，在列表、交易帳本與總覽「支出去向」圖表裡一眼認出是誰。
--
-- - avatar_r2_key     R2 上的物件 key，固定是 orgs/<organization_id>/parties/<party_id>/avatar-<毫秒時間戳>.<ext>
--                     （src/lib/party-avatar.ts buildPartyAvatarKey）。NULL = 沒有頭像，畫面改用首字 + 依名稱決定的底色。
-- - avatar_updated_at 最後一次換圖 / 移除的時間；網址帶 ?v=<這個時間> 當 cache buster，
--                     所以讀取端可以放心給 Cache-Control: private, max-age=86400。
--
-- 圖一律在瀏覽器裁成正方形、縮到 256×256 再上傳（WebP，瀏覽器不支援時退回 JPEG）；
-- server 端再驗一次 magic bytes 與大小（≤ 200 KB），不接受 SVG（stored XSS）。
-- 讀取走 /api/parties/<id>/avatar，先確認該對象屬於呼叫者當前的組織才從 R2 串流（bucket 非公開）。
-- 換圖時舊物件會被刪掉；交易對象軟刪除時不動頭像（跟著那一列一起留著，復原時還在）。
--
-- ⚠️ 部署順序：先跑這支 migration 再部署程式碼。listParties 會 select 這兩欄，欄位不存在時
-- 交易對象、交易帳本、總覽頁都會壞。
--
-- Forward-only，全部 additive（兩欄皆可為 NULL）。Run AFTER 0029。
-- （0031 保留給同期開發的雲端帳單表。）

ALTER TABLE parties ADD COLUMN avatar_r2_key text;
ALTER TABLE parties ADD COLUMN avatar_updated_at timestamptz;

COMMENT ON COLUMN parties.avatar_r2_key IS '頭像在 R2 的 key：orgs/<org>/parties/<id>/avatar-<ts>.<ext>；NULL = 沒有頭像';
COMMENT ON COLUMN parties.avatar_updated_at IS '頭像最後更新 / 移除時間；UI 網址的 cache buster';
