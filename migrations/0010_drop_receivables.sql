-- Remove the receivables (應收帳款) feature. Contracts + the transaction→contract
-- binding (contract_id, migrations/0009) now answer 「客戶付了多少 / 還沒付多少」 via
-- 已收/未收, which is what this org actually needs. The receivables table was never
-- used in prod (0 rows on 2026-06-29), and its only unique capability — dated
-- installment schedules + overdue aging — was entirely unexercised. Forward-only.
-- Run AFTER 0009_txn_contract.sql.
--
-- If dated AR aging is wanted again later, reintroduce it as a `contract_payments`
-- child of contracts (contract_id + amount + due_date + status), not a parallel table.

-- Safety guard: abort if any receivable rows exist (in case data appeared after the
-- snapshot) so this never silently destroys real records.
DO $$
BEGIN
  IF (SELECT count(*) FROM receivables) > 0 THEN
    RAISE EXCEPTION 'receivables is not empty (% rows) — stop and migrate the data before dropping',
      (SELECT count(*) FROM receivables);
  END IF;
END $$;

-- No table FK-references receivables (the historical links.receivable_id was dropped
-- in 0008), so this drop has no dependents.
DROP TABLE IF EXISTS receivables;
