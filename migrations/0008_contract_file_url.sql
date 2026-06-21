-- Replace the standalone links table with a per-contract file link: a contract
-- now carries one file_url (e.g. the Google Drive link to the signed contract).
-- Forward-only. Run AFTER 0007_links.sql.
DROP TABLE IF EXISTS links;
ALTER TABLE contracts ADD COLUMN file_url text;
