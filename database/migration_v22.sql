-- WITHX Performance Calculation Alignment v22
--
-- Aligns the active database with the two-component performance system:
--   Attendance Deduction + Task Deduction = Total Deduction
--
-- Existing performance data is NOT recalculated and legacy column data is
-- preserved when those legacy columns still exist.

BEGIN;

-- Older databases may still contain these legacy fields. Keep their data,
-- but make them optional so the current backend does not need to write them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name='performance_scores'
      AND column_name='on_time'
  ) THEN
    ALTER TABLE performance_scores
      ALTER COLUMN on_time DROP NOT NULL,
      ALTER COLUMN on_time SET DEFAULT 100;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name='performance_scores'
      AND column_name='punctuality'
  ) THEN
    ALTER TABLE performance_scores
      ALTER COLUMN punctuality DROP NOT NULL,
      ALTER COLUMN punctuality SET DEFAULT 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name='performance_scores'
      AND column_name='report_consistency'
  ) THEN
    ALTER TABLE performance_scores
      ALTER COLUMN report_consistency DROP NOT NULL,
      ALTER COLUMN report_consistency SET DEFAULT 0;
  END IF;
END $$;

ALTER TABLE performance_scores
  ADD COLUMN IF NOT EXISTS task_deduction NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leave_deduction NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductions NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_required_minutes NUMERIC(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_worked_minutes NUMERIC(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_missing_minutes NUMERIC(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_deduction NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_total_score NUMERIC(14,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_deadline_days INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS task_late_deduction_per_day NUMERIC(12,8) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS total_working_days INTEGER NOT NULL DEFAULT 26,
  ADD COLUMN IF NOT EXISTS task_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS base_pay NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS base_pay_label VARCHAR(80);

ALTER TABLE performance_scores
  ALTER COLUMN task_completion TYPE NUMERIC(12,8)
    USING task_completion::numeric,
  ALTER COLUMN attendance TYPE NUMERIC(12,8)
    USING attendance::numeric,
  ALTER COLUMN working_hours TYPE NUMERIC(12,8)
    USING working_hours::numeric,
  ALTER COLUMN required_work_hours TYPE NUMERIC(12,8)
    USING required_work_hours::numeric,
  ALTER COLUMN task_deduction TYPE NUMERIC(12,8)
    USING task_deduction::numeric,
  ALTER COLUMN leave_deduction TYPE NUMERIC(12,8)
    USING leave_deduction::numeric,
  ALTER COLUMN deductions TYPE NUMERIC(12,8)
    USING deductions::numeric,
  ALTER COLUMN attendance_deduction TYPE NUMERIC(12,8)
    USING attendance_deduction::numeric,
  ALTER COLUMN score TYPE NUMERIC(12,8)
    USING score::numeric;

CREATE TABLE IF NOT EXISTS performance_attendance_daily (
  id BIGSERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  required_minutes NUMERIC(14,4) NOT NULL DEFAULT 180,
  worked_minutes NUMERIC(14,4) NOT NULL DEFAULT 0,
  missing_minutes NUMERIC(14,4) NOT NULL DEFAULT 0,
  attendance_percentage NUMERIC(12,8) NOT NULL DEFAULT 0,
  deduction_percentage NUMERIC(12,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_performance_attendance_daily_employee_date
  ON performance_attendance_daily(employee_id, work_date);

COMMIT;
