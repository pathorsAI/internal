-- Links: a place to paste external URLs (e.g. Google Drive contracts) and
-- optionally attach them to a customer / project / contract / subscription /
-- receivable. Forward-only, additive. Run AFTER 0006_mcp_oauth.sql.
-- Entity FKs are ON DELETE SET NULL so deleting an entity just detaches the link.
CREATE TABLE links (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text REFERENCES "organization"(id),
  title           text NOT NULL,
  url             text NOT NULL,
  note            text,
  party_id        bigint REFERENCES parties(id)        ON DELETE SET NULL,
  project_id      bigint REFERENCES projects(id)       ON DELETE SET NULL,
  contract_id     bigint REFERENCES contracts(id)      ON DELETE SET NULL,
  subscription_id bigint REFERENCES subscriptions(id)  ON DELETE SET NULL,
  receivable_id   bigint REFERENCES receivables(id)    ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_links_org      ON links(organization_id);
CREATE INDEX idx_links_party    ON links(party_id);
CREATE INDEX idx_links_project  ON links(project_id);
CREATE INDEX idx_links_contract ON links(contract_id);
