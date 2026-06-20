-- MCP OAuth: tables for the better-auth `mcp` plugin (OAuth 2.0 / OIDC provider).
-- Forward-only, additive. Run AFTER 0005_invitation_columns.sql.
-- These let MCP clients (e.g. Claude) authenticate via OAuth and call /api/mcp.
-- "user" is a reserved word, hence the quoting (matches the auth tables).

-- 1) Registered OAuth clients. Dynamic Client Registration writes here, so most
--    rows are created automatically when an MCP client first connects.
CREATE TABLE oauth_application (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  icon          text,
  metadata      text,
  client_id     text NOT NULL UNIQUE,
  client_secret text,
  redirect_urls text NOT NULL,
  type          text NOT NULL,
  disabled      boolean NOT NULL DEFAULT false,
  user_id       text REFERENCES "user"(id) ON DELETE CASCADE,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_application_user ON oauth_application(user_id);

-- 2) Issued access / refresh tokens. Bearer tokens on MCP requests are validated
--    against this table. client_id references the unique client_id above.
CREATE TABLE oauth_access_token (
  id                       text PRIMARY KEY,
  access_token             text NOT NULL UNIQUE,
  refresh_token            text NOT NULL UNIQUE,
  access_token_expires_at  timestamp NOT NULL,
  refresh_token_expires_at timestamp NOT NULL,
  client_id                text NOT NULL REFERENCES oauth_application(client_id) ON DELETE CASCADE,
  user_id                  text REFERENCES "user"(id) ON DELETE CASCADE,
  scopes                   text,
  created_at               timestamp NOT NULL DEFAULT now(),
  updated_at               timestamp NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_access_token_client ON oauth_access_token(client_id);
CREATE INDEX idx_oauth_access_token_user   ON oauth_access_token(user_id);

-- 3) Per-user consent records (which client the user authorized, and for what).
CREATE TABLE oauth_consent (
  id            text PRIMARY KEY,
  client_id     text NOT NULL REFERENCES oauth_application(client_id) ON DELETE CASCADE,
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scopes        text,
  consent_given boolean NOT NULL DEFAULT false,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_consent_client ON oauth_consent(client_id);
CREATE INDEX idx_oauth_consent_user   ON oauth_consent(user_id);
