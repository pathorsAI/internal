-- 0028: 操作紀錄加一個來源 'system'。
--
-- 整合每日自動同步（src/lib/integrations/autosync.ts，Cloudflare Cron Trigger 觸發）
-- 不是任何成員發起的，所以不能記成 web 或 mcp、也不能冒充某位成員。它寫進
-- activity_log 時 channel = 'system'，actor_user_id / actor_email / actor_name 皆 NULL。
--
-- 在這支 migration 跑之前部署程式碼也安全：src/db/activity.ts 的 record() 會吞掉
-- CHECK 違規，只是少記那幾筆「系統自動同步」的操作紀錄，同步本身照常。
--
-- Forward-only，只放寬 CHECK。Run AFTER 0027。

ALTER TABLE activity_log DROP CONSTRAINT chk_activity_channel;
ALTER TABLE activity_log
  ADD CONSTRAINT chk_activity_channel CHECK (channel = ANY (ARRAY['web', 'mcp', 'system']));
