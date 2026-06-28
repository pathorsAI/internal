-- Make payroll-run period uniqueness ORG-SCOPED. The original constraint
-- uq_run_period was UNIQUE (period_year, period_month) with no organization_id,
-- so the first org to create a payroll run for a given month globally blocked
-- every OTHER org from creating a run for that same month (pay_employee_salary
-- then failed for them). Multi-tenant correctness bug. Forward-only.
-- Run AFTER 0010_drop_receivables.sql.

-- Safety guard: the new (org, year, month) key is strictly looser than the old
-- global (year, month) key, so existing rows cannot collide. Abort loudly if
-- they somehow do, rather than failing mid-DDL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM payroll_runs
    GROUP BY organization_id, period_year, period_month
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'payroll_runs has duplicate (organization_id, period_year, period_month) rows — resolve before re-adding the unique constraint';
  END IF;
END $$;

ALTER TABLE payroll_runs DROP CONSTRAINT uq_run_period;
ALTER TABLE payroll_runs ADD CONSTRAINT uq_run_period UNIQUE (organization_id, period_year, period_month);
