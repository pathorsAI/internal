-- Rename the legacy org created in 0002 from "Pathors" to the real company
-- name. Forward-only, idempotent. The id (org_pathors) and slug (pathors) stay
-- stable so nothing else needs to change.
UPDATE "organization"
SET name = '派斯科技股份有限公司'
WHERE id = 'org_pathors';
