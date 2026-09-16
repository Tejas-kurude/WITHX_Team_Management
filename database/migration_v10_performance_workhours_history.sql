  BEGIN;

  -- Preserve the work-hours target used by each historical performance calculation.
  ALTER TABLE performance_scores
    ADD COLUMN IF NOT EXISTS required_work_hours NUMERIC(5,2);

  -- Backfill existing performance records using the work-hours target that was
  -- configured before employee/team/department overrides existed.
  UPDATE performance_scores
  SET required_work_hours = COALESCE(
    (
      SELECT GREATEST(0.01, LEAST(24, (NULLIF(value, '')::numeric) / 60.0))
      FROM system_settings
      WHERE key = 'minimum_work_minutes'
      LIMIT 1
    ),
    3.00
  )
  WHERE required_work_hours IS NULL;

  ALTER TABLE performance_scores
    ALTER COLUMN required_work_hours SET DEFAULT 3.00,
    ALTER COLUMN required_work_hours SET NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_performance_scores_employee_period
    ON performance_scores(employee_id, period_end DESC, created_at DESC);

  COMMIT;
