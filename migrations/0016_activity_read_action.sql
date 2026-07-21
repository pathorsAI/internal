-- 0016: activity_log 的 action 增加 'read' — 員工個資（email/電話/遮罩後的
-- 身分證與薪轉帳戶）經 MCP 被讀取時也留稽核紀錄，不再只記寫入。
ALTER TABLE activity_log DROP CONSTRAINT chk_activity_action;
ALTER TABLE activity_log ADD CONSTRAINT chk_activity_action
  CHECK (action = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'read'::text]));
