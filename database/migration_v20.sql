-- WITHX Performance Calculation System v2
-- Run once on the existing database.

BEGIN;

-- Performance calculation configuration defaults.
INSERT INTO system_settings(key,value)
VALUES
  ('performance_total_working_days','26'),
  ('performance_default_daily_required_minutes','180'),
  ('performance_task_deadline_days','5'),
  ('performance_task_late_deduction_per_day','20')
ON CONFLICT(key) DO NOTHING;

-- Date-specific work-hours rules. These are separate from general rules.
CREATE TABLE IF NOT EXISTS work_hours_date_overrides (
  id BIGSERIAL PRIMARY KEY,
  effective_date DATE NOT NULL,
  scope VARCHAR(20) NOT NULL
    CHECK (scope IN ('DEFAULT','DEPARTMENT','TEAM','EMPLOYEE')),
  scope_id INTEGER NULL,
  hours NUMERIC(5,2) NOT NULL
    CHECK (hours > 0 AND hours <= 24),
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_hours_date_default
  ON work_hours_date_overrides(effective_date, scope)
  WHERE scope='DEFAULT';

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_hours_date_scoped
  ON work_hours_date_overrides(effective_date, scope, scope_id)
  WHERE scope<>'DEFAULT';

CREATE INDEX IF NOT EXISTS idx_work_hours_date_scope_target
  ON work_hours_date_overrides(effective_date, scope, scope_id);

CREATE TABLE IF NOT EXISTS performance_attendance_daily (
  id BIGSERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  required_minutes NUMERIC(12,4) NOT NULL CHECK (required_minutes >= 0),
  worked_minutes NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  missing_minutes NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (missing_minutes >= 0),
  attendance_percentage NUMERIC(12,8) NOT NULL DEFAULT 0,
  deduction_percentage NUMERIC(12,8) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_performance_attendance_daily_employee_date
  ON performance_attendance_daily(employee_id, work_date);

ALTER TABLE performance_scores
  ADD COLUMN IF NOT EXISTS task_deduction NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leave_deduction NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductions NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_required_minutes NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_worked_minutes NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_missing_minutes NUMERIC(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attendance_deduction NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_total_score NUMERIC(12,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_deadline_days INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS task_late_deduction_per_day NUMERIC(12,8) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS total_working_days INTEGER NOT NULL DEFAULT 26,
  ADD COLUMN IF NOT EXISTS task_details JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS base_pay NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS base_pay_label VARCHAR(40);

ALTER TABLE performance_scores
  ALTER COLUMN task_completion TYPE NUMERIC(12,8),
  ALTER COLUMN attendance TYPE NUMERIC(12,8),
  ALTER COLUMN working_hours TYPE NUMERIC(12,8),
  ALTER COLUMN required_work_hours TYPE NUMERIC(12,8),
  ALTER COLUMN task_deduction TYPE NUMERIC(12,8),
  ALTER COLUMN leave_deduction TYPE NUMERIC(12,8),
  ALTER COLUMN deductions TYPE NUMERIC(12,8),
  ALTER COLUMN score TYPE NUMERIC(12,8);

COMMIT;
