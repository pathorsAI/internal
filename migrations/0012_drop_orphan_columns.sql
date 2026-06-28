-- Drop orphan columns: pre-implementation artifacts with zero reads/writes
-- anywhere in the app (verified across queries.ts, mutations.ts, MCP tools, and
-- UI). They were defined in the initial schema and never wired up.
--   transactions.original_amount / original_currency / fx_rate
--     — an abandoned multi-currency FX-entry design; the app records the
--       converted value in amount_twd and never used these.
--   transactions.transfer_group_id — unused transfer-grouping id (transfers
--     only ever set from_account_id / to_account_id).
--   documents.period_label — never written or read.
-- Forward-only. Deploy the matching schema.ts change FIRST, then run this so the
-- live worker no longer selects these columns. Run AFTER the 0011_* migrations.
ALTER TABLE transactions DROP COLUMN IF EXISTS original_amount;
ALTER TABLE transactions DROP COLUMN IF EXISTS original_currency;
ALTER TABLE transactions DROP COLUMN IF EXISTS fx_rate;
ALTER TABLE transactions DROP COLUMN IF EXISTS transfer_group_id;
ALTER TABLE documents DROP COLUMN IF EXISTS period_label;
