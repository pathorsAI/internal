-- Multi-tenancy: scope existing domain tables to an organization.
-- Forward-only, additive (nullable column) + backfill of existing rows to a
-- legacy "Pathors" org. Run AFTER 0001_auth.sql.

-- 1) Add nullable organization_id to every tenant-scoped table.
ALTER TABLE categories               ADD COLUMN organization_id text;
ALTER TABLE bank_accounts            ADD COLUMN organization_id text;
ALTER TABLE invoices                 ADD COLUMN organization_id text;
ALTER TABLE employees                ADD COLUMN organization_id text;
ALTER TABLE payroll_runs             ADD COLUMN organization_id text;
ALTER TABLE payroll_item_types       ADD COLUMN organization_id text;
ALTER TABLE parties                  ADD COLUMN organization_id text;
ALTER TABLE transactions             ADD COLUMN organization_id text;
ALTER TABLE account_reconciliations  ADD COLUMN organization_id text;
ALTER TABLE documents                ADD COLUMN organization_id text;

-- 2) Seed a legacy org for the existing Pathors data and backfill everything.
INSERT INTO "organization" (id, name, slug, created_at)
VALUES ('org_pathors', 'Pathors', 'pathors', now())
ON CONFLICT (id) DO NOTHING;

UPDATE categories              SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE bank_accounts           SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE invoices                SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE employees               SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE payroll_runs            SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE payroll_item_types      SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE parties                 SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE transactions            SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE account_reconciliations SET organization_id = 'org_pathors' WHERE organization_id IS NULL;
UPDATE documents               SET organization_id = 'org_pathors' WHERE organization_id IS NULL;

-- 3) FKs to organization (kept simple; ON DELETE handled by app, not cascade).
ALTER TABLE categories              ADD CONSTRAINT categories_org_fk              FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE bank_accounts           ADD CONSTRAINT bank_accounts_org_fk           FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE invoices                ADD CONSTRAINT invoices_org_fk                FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE employees               ADD CONSTRAINT employees_org_fk               FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE payroll_runs            ADD CONSTRAINT payroll_runs_org_fk            FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE payroll_item_types      ADD CONSTRAINT payroll_item_types_org_fk      FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE parties                 ADD CONSTRAINT parties_org_fk                 FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE transactions            ADD CONSTRAINT transactions_org_fk            FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE account_reconciliations ADD CONSTRAINT account_reconciliations_org_fk FOREIGN KEY (organization_id) REFERENCES "organization"(id);
ALTER TABLE documents               ADD CONSTRAINT documents_org_fk               FOREIGN KEY (organization_id) REFERENCES "organization"(id);

-- 4) Indexes for the org filter that every query now applies.
CREATE INDEX idx_categories_org              ON categories(organization_id);
CREATE INDEX idx_bank_accounts_org           ON bank_accounts(organization_id);
CREATE INDEX idx_invoices_org                ON invoices(organization_id);
CREATE INDEX idx_employees_org               ON employees(organization_id);
CREATE INDEX idx_payroll_runs_org            ON payroll_runs(organization_id);
CREATE INDEX idx_payroll_item_types_org      ON payroll_item_types(organization_id);
CREATE INDEX idx_parties_org                 ON parties(organization_id);
CREATE INDEX idx_transactions_org            ON transactions(organization_id);
CREATE INDEX idx_account_reconciliations_org ON account_reconciliations(organization_id);
CREATE INDEX idx_documents_org               ON documents(organization_id);

-- 5) Party name uniqueness is now per-org, not global.
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_name_key;
ALTER TABLE parties ADD CONSTRAINT parties_name_key UNIQUE (organization_id, name);

-- NOTE: after the Pathors admin signs up via the app, attach them to the
-- legacy org so they can see the migrated data:
--   INSERT INTO member (id, organization_id, user_id, role)
--   VALUES (gen_random_uuid()::text, 'org_pathors', '<their user id>', 'owner');
