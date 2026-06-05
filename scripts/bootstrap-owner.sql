-- Bootstrap the FIRST owner of the legacy org (派斯科技股份有限公司 / org_pathors).
--
-- WHY this is a separate script and NOT a migration:
--   The user row only exists AFTER the person logs in via Google at least once.
--   Migrations run before anyone has logged in, so the very first owner of a
--   fresh deployment must be attached out-of-band. This is normal for every
--   multi-tenant app (you can't invite the first user — there's no inviter yet).
--
-- HOW TO USE (production):
--   1. Apply migrations 0001 → 0004 first (creates org + binds existing data).
--   2. Deploy the app and have contact@pathors.com sign in via Google ONCE
--      (this creates their `user` row; they'll land on /onboarding).
--   3. Run this script against production.
--   4. They refresh — they're now owner of 派斯科技 and see the migrated data.
--
-- Idempotent: safe to run multiple times. Change the email below if needed.
DO $$
DECLARE
  v_email text := 'contact@pathors.com';
  v_org   text := 'org_pathors';
  v_user_id text;
BEGIN
  SELECT id INTO v_user_id FROM "user" WHERE lower(email) = lower(v_email);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION
      'User % not found. Have them sign in via Google once, then re-run.', v_email;
  END IF;

  -- Attach as owner (skip if already a member of this org).
  IF NOT EXISTS (
    SELECT 1 FROM member WHERE organization_id = v_org AND user_id = v_user_id
  ) THEN
    INSERT INTO member (id, organization_id, user_id, role, created_at)
    VALUES (replace(gen_random_uuid()::text, '-', ''), v_org, v_user_id, 'owner', now());
    RAISE NOTICE 'Added % as owner of %.', v_email, v_org;
  ELSE
    RAISE NOTICE '% is already a member of %; left as-is.', v_email, v_org;
  END IF;

  -- Point their existing session(s) at the org so they don't have to re-login.
  UPDATE session SET active_organization_id = v_org WHERE user_id = v_user_id;
END $$;
