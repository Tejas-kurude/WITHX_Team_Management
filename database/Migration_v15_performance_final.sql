-- Performance deduction split migration
-- Run this once after the performance_scores table exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='performance_scores' AND column_name='deductions')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='performance_scores' AND column_name='task_deduction') THEN
    ALTER TABLE performance_scores RENAME COLUMN deductions TO task_deduction;
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='performance_scores' AND column_name='task_deduction') THEN
    ALTER TABLE performance_scores ADD COLUMN task_deduction NUMERIC(6,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='performance_scores' AND column_name='leave_deduction') THEN
    ALTER TABLE performance_scores ADD COLUMN leave_deduction NUMERIC(6,2) NOT NULL DEFAULT 0;
  END IF;
END $$;
