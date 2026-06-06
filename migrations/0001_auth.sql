-- better-auth core + organization plugin tables.
-- Forward-only. Mirrors src/db/auth-schema.ts.

CREATE TABLE "user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE "session" (
  id text PRIMARY KEY,
  expires_at timestamp NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  active_organization_id text
);

CREATE TABLE "account" (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamp,
  refresh_token_expires_at timestamp,
  scope text,
  password text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE "verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamp NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE "organization" (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE,
  logo text,
  created_at timestamp NOT NULL DEFAULT now(),
  metadata text
);

CREATE TABLE "member" (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE "invitation" (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES "organization"(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamp NOT NULL,
  inviter_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE INDEX idx_session_user ON "session"(user_id);
CREATE INDEX idx_account_user ON "account"(user_id);
CREATE INDEX idx_member_org ON "member"(organization_id);
CREATE INDEX idx_member_user ON "member"(user_id);
CREATE INDEX idx_invitation_org ON "invitation"(organization_id);
