-- WITHX Team Management
-- Issue 4: Performance-score migration
-- Run this file in pgAdmin Query Tool.
--
-- This migration:
-- 1. Recalculates score from the existing deductions value.
-- 2. Removes the unnecessary legacy performance columns.
-- 3. Preserves existing performance records.
--
-- WARNING:
-- The columns on_time, punctuality, and report_consistency
-- will be permanently removed from performance_scores.

BEGIN;

-- Recalculate the performance score.
-- Score = 100 - deductions
-- Score remains between 0 and 100.

UPDATE performance_scores
SET score = GREATEST(
    0,
    LEAST(
        100,
        ROUND((100 - COALESCE(deductions, 0))::numeric, 2)
    )
);

-- Remove unnecessary legacy performance columns.

ALTER TABLE performance_scores
    DROP COLUMN IF EXISTS on_time,
    DROP COLUMN IF EXISTS punctuality,
    DROP COLUMN IF EXISTS report_consistency;

COMMIT;

-- Verification query:

SELECT
    employee_id,
    period_start,
    period_end,
    task_deduction,
    leave_deduction,
    deductions,
    score
FROM performance_scores
ORDER BY period_end DESC;