-- Client operations: projects, subscriptions (recurring fees), contracts, and
-- accounts receivable. Forward-only, additive. Run AFTER 0002_org_scoping.sql.
-- All tables are org-scoped (organization_id) like the existing domain tables.

-- 1) Projects (專案). Per-project P&L is computed from transactions.project_id,
--    so a project here is just a label + optional owning customer.
CREATE TABLE projects (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text REFERENCES "organization"(id),
  name            text NOT NULL,
  client_party_id bigint REFERENCES parties(id),
  status          text NOT NULL DEFAULT 'active',
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_project_status CHECK (status = ANY (ARRAY['active','archived']))
);
CREATE INDEX idx_projects_org    ON projects(organization_id);
CREATE INDEX idx_projects_client ON projects(client_party_id);

-- 2) Subscriptions / monthly fees (客戶訂閱 / 月費). interval_months = 多久收一次.
CREATE TABLE subscriptions (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   text REFERENCES "organization"(id),
  customer_party_id bigint NOT NULL REFERENCES parties(id),
  project_id        bigint REFERENCES projects(id),
  name              text NOT NULL,
  amount            numeric(18,2) NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'TWD',
  interval_months   integer NOT NULL DEFAULT 1,
  start_date        date NOT NULL,
  end_date          date,
  status            text NOT NULL DEFAULT 'active',
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_subscription_status CHECK (status = ANY (ARRAY['active','paused','ended']))
);
CREATE INDEX idx_subscriptions_org      ON subscriptions(organization_id);
CREATE INDEX idx_subscriptions_customer ON subscriptions(customer_party_id);

-- 3) Contracts (合約).
CREATE TABLE contracts (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id   text REFERENCES "organization"(id),
  customer_party_id bigint NOT NULL REFERENCES parties(id),
  project_id        bigint REFERENCES projects(id),
  title             text NOT NULL,
  amount            numeric(18,2),
  currency          char(3) NOT NULL DEFAULT 'TWD',
  start_date        date,
  end_date          date,
  status            text NOT NULL DEFAULT 'active',
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_contract_status CHECK (status = ANY (ARRAY['draft','active','completed','cancelled']))
);
CREATE INDEX idx_contracts_org      ON contracts(organization_id);
CREATE INDEX idx_contracts_customer ON contracts(customer_party_id);

-- 4) Accounts receivable (應收帳款). Standalone rows that can optionally link to
--    a contract / subscription / project. On collection we set paid_transaction_id
--    to the income transaction that settled it.
CREATE TABLE receivables (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id     text REFERENCES "organization"(id),
  customer_party_id   bigint NOT NULL REFERENCES parties(id),
  contract_id         bigint REFERENCES contracts(id),
  subscription_id     bigint REFERENCES subscriptions(id),
  project_id          bigint REFERENCES projects(id),
  description         text,
  amount              numeric(18,2) NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'TWD',
  due_date            date,
  status              text NOT NULL DEFAULT 'open',
  paid_transaction_id bigint REFERENCES transactions(id),
  paid_at             date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_receivable_status CHECK (status = ANY (ARRAY['open','paid','void']))
);
CREATE INDEX idx_receivables_org      ON receivables(organization_id);
CREATE INDEX idx_receivables_customer ON receivables(customer_party_id);
CREATE INDEX idx_receivables_status   ON receivables(status);

-- 5) Tag transactions with the project they belong to (vendor ≠ project: a txn
--    still carries party_id for the vendor/customer AND project_id for the project).
ALTER TABLE transactions ADD COLUMN project_id bigint REFERENCES projects(id);
CREATE INDEX idx_txn_project ON transactions(project_id);
