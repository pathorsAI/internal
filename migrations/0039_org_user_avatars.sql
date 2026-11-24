-- 0039: 組織 logo 與使用者頭像。
--
-- 存放方式跟交易對象頭像（0030）一樣：圖在瀏覽器裁成正方形、縮到 256×256 再上傳，server 驗 magic bytes
-- 與大小（≤ 200 KB，PNG / JPEG / WebP，不收 SVG），放在同一個物件儲存（R2 / S3 / 本機檔案）。
--
-- - organization.logo_key  物件 key：orgs/<organization_id>/logo-<毫秒>.<ext>。NULL = 沒有上傳 logo。
-- - "user".avatar_key      物件 key：users/<user_id>/avatar-<毫秒>.<ext>。NULL = 沒有上傳頭像。
--
-- 給畫面用的網址寫在 better-auth 既有的 organization.logo / "user".image：
-- /api/orgs/<id>/logo?v=<毫秒>、/api/users/<id>/avatar?v=<毫秒>（v 是 cache buster）。
-- session 與組織清單本來就帶這兩欄，所以側欄、使用者選單不用另外查。
-- 讀取一律走那兩支 API：先確認呼叫者是該組織的成員／跟該使用者同組織，才從儲存串流（bucket 非公開）。
-- 使用者用 Google 登入時 image 原本可能是 Google 的頭像網址，沒有上傳過就照舊顯示；按「移除」會一併清掉。
--
-- 程式比這支 migration 先上會壞：auth-schema 的 user / organization 會 select 這兩欄，欄位不存在時
-- 登入與組織清單都會失敗。先跑 migration 再部署。
--
-- Forward-only，全部 additive（皆可為 NULL）。Run AFTER 0038。

ALTER TABLE organization ADD COLUMN logo_key text;
ALTER TABLE "user" ADD COLUMN avatar_key text;
