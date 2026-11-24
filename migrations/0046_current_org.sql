-- 0046: 每位使用者一個「目前的組織」—— 網頁的組織切換器、站內 AI、LINE／WhatsApp、MCP 共用。
--
-- 問題：同時在好幾個組織（派斯／東蜂）的人，每次跟 MCP 對話都被問一次「要用哪個組織」；
-- 站內 AI 又被鎖在當下 session 的組織。組織只記在 session.active_organization_id，換一台裝置、
-- 開一段新的 MCP 連線就不知道上次在哪。
--
-- "user".current_org_id：這個人目前在操作的組織。
--   - 網頁切換組織（/organization/set-active）時寫入（src/lib/auth.ts 的 hooks.after）。
--   - 新的 session 從它開始（session.create 的 databaseHook、src/lib/session.ts 的 requireOrg）。
--   - MCP 沒指定組織時用它（src/lib/mcp/org.ts）；站內 AI 讀寫預設也是它，但可以跨到本人的其他組織。
--   - 讀的時候一律再檢查一次還是不是成員；不是（被移出）就退回最早加入的組織。
--   - 組織被刪除時變 NULL（ON DELETE SET NULL）。
--
-- 回填：每個人最近一個 session 的 active_organization_id（而且還是那個組織的成員），
-- 沒有的話用最早加入的組織。
--
-- 執行順序：在 0045 之後跑（0044、0045 是其他 PR 的 migration）。程式碼比 migration 先上
-- 不安全（auth-schema 會 select 這一欄），所以要先跑 migration 再部署。

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS current_org_id text REFERENCES organization(id) ON DELETE SET NULL;

-- 最近一個 session 的組織（必須仍是成員）
UPDATE "user" u
SET current_org_id = s.active_organization_id
FROM (
  SELECT DISTINCT ON (se.user_id) se.user_id, se.active_organization_id
  FROM session se
  JOIN member m ON m.user_id = se.user_id AND m.organization_id = se.active_organization_id
  WHERE se.active_organization_id IS NOT NULL
  ORDER BY se.user_id, se.updated_at DESC
) s
WHERE s.user_id = u.id AND u.current_org_id IS NULL;

-- 沒有 session 可參考的人：最早加入的組織
UPDATE "user" u
SET current_org_id = m.organization_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, organization_id
  FROM member
  ORDER BY user_id, created_at ASC
) m
WHERE m.user_id = u.id AND u.current_org_id IS NULL;
