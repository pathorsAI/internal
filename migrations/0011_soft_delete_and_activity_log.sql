-- Soft delete + org activity (audit) log. Forward-only. Run AFTER 0010.
--
-- 1) Deletes become soft: every domain table that has a delete action gains a
--    nullable deleted_at. Mutations set deleted_at = now() instead of removing
--    the row; every list/get/aggregate query filters deleted_at IS NULL.
-- 2) activity_log records who did what (create/update/delete) on which entity,
--    for BOTH web server actions and OAuth-authenticated MCP tool calls, so the
--    org can see if someone mis-recorded or wrongly deleted something.

CREATE TABLE activity_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text REFERENCES "organization"(id),
  actor_user_id   text,                 -- user.id (null = system)
  actor_email     text,
  actor_name      text,
  channel         text NOT NULL DEFAULT 'web',   -- web | mcp
  action          text NOT NULL,                 -- create | update | delete
  entity_type     text NOT NULL,                 -- transaction, party, contract, ...
  entity_id       bigint,
  summary         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_activity_channel CHECK (channel = ANY (ARRAY['web','mcp'])),
  CONSTRAINT chk_activity_action  CHECK (action  = ANY (ARRAY['create','update','delete']))
);
CREATE INDEX idx_activity_org_time   ON activity_log(organization_id, created_at DESC);
CREATE INDEX idx_activity_entity     ON activity_log(organization_id, entity_type, entity_id);

-- Soft-delete column on every domain table with a delete action.
ALTER TABLE transactions             ADD COLUMN deleted_at timestamptz;
ALTER TABLE parties                  ADD COLUMN deleted_at timestamptz;
ALTER TABLE categories               ADD COLUMN deleted_at timestamptz;
ALTER TABLE bank_accounts            ADD COLUMN deleted_at timestamptz;
ALTER TABLE employees                ADD COLUMN deleted_at timestamptz;
ALTER TABLE invoices                 ADD COLUMN deleted_at timestamptz;
ALTER TABLE account_reconciliations  ADD COLUMN deleted_at timestamptz;
ALTER TABLE projects                 ADD COLUMN deleted_at timestamptz;
ALTER TABLE subscriptions            ADD COLUMN deleted_at timestamptz;
ALTER TABLE contracts                ADD COLUMN deleted_at timestamptz;
ALTER TABLE documents                ADD COLUMN deleted_at timestamptz;
ALTER TABLE payroll_runs             ADD COLUMN deleted_at timestamptz;
ALTER TABLE payslips                 ADD COLUMN deleted_at timestamptz;

-- Unique constraints must ignore soft-deleted rows, so the name/slot frees up
-- when a row is "deleted" and can be reused (replace constraint with a partial
-- unique index scoped to live rows).
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_name_key;
CREATE UNIQUE INDEX parties_name_key
  ON parties(organization_id, name) WHERE deleted_at IS NULL;

ALTER TABLE account_reconciliations DROP CONSTRAINT IF EXISTS uq_recon_account_date;
CREATE UNIQUE INDEX uq_recon_account_date
  ON account_reconciliations(account_id, as_of_date) WHERE deleted_at IS NULL;
