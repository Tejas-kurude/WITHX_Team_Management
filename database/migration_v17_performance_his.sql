BEGIN;

-- These columns are already present in many databases, so this is safe to rerun.
ALTER TABLE performance_scores
  ADD COLUMN IF NOT EXISTS task_deduction NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE performance_scores
  ADD COLUMN IF NOT EXISTS leave_deduction NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE performance_scores
  ADD COLUMN IF NOT EXISTS deductions NUMERIC(6,2) NOT NULL DEFAULT 0;

-- The old rolling-performance rows are preserved.
-- Only new monthly rows use period_start = the first day of the month.
--
-- Start monthly uniqueness from September 2026, which is the first
-- month of the new monthly-performance system. Legacy August rows,
-- including old 1st-of-month rolling snapshots, remain untouched.
CREATE UNIQUE INDEX IF NOT EXISTS uq_performance_scores_employee_monthly
  ON performance_scores(employee_id, period_start)
  WHERE period_start >= DATE '2026-09-01'
    AND EXTRACT(DAY FROM period_start) = 1;

COMMIT;
