-- better-auth's invitation model writes `createdAt` (and a nullish `teamId`) on
-- every createInvitation call. Our original 0001 invitation table was missing
-- both columns, so inviteMember failed with a 500 (INSERT into non-existent
-- columns). Additive, forward-only, idempotent.
ALTER TABLE "invitation"
  ADD COLUMN IF NOT EXISTS created_at timestamp NOT NULL DEFAULT now();

ALTER TABLE "invitation"
  ADD COLUMN IF NOT EXISTS team_id text;
