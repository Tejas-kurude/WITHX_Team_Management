-- WITHX Management Platform v4
-- Task Completion Verification Workflow

BEGIN;

-- ============================================================
-- 1. TASK TYPE
-- ============================================================

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS task_type VARCHAR(20) NOT NULL DEFAULT 'TECHNICAL';

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_task_type_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_task_type_check
CHECK (task_type IN ('TECHNICAL', 'NON_TECHNICAL'));


-- ============================================================
-- 2. UPDATE TASK STATUS
-- ============================================================

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS tasks_status_check;

ALTER TABLE tasks
ADD CONSTRAINT tasks_status_check
CHECK (
  status IN (
    'PENDING',
    'IN_PROGRESS',
    'BLOCKED',
    'SUBMITTED',
    'NEEDS_CHANGES',
    'COMPLETED',
    'REJECTED',
    'CANCELLED'
  )
);


-- ============================================================
-- 3. COMPLETION SUBMISSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS task_completion_submissions (
  id SERIAL PRIMARY KEY,

  task_id INT NOT NULL
    REFERENCES tasks(id)
    ON DELETE CASCADE,

  submitted_by INT NOT NULL
    REFERENCES employees(id)
    ON DELETE RESTRICT,

  completion_summary TEXT NOT NULL,

  proof_type VARCHAR(30) NOT NULL
    CHECK (
      proof_type IN (
        'GITHUB',
        'GOOGLE_DRIVE'
      )
    ),

  proof_url TEXT NOT NULL,

  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  review_decision VARCHAR(30)
    CHECK (
      review_decision IS NULL OR
      review_decision IN (
        'APPROVE',
        'NEEDS_CHANGES',
        'REJECT'
      )
    ),

  reviewed_by INT
    REFERENCES employees(id)
    ON DELETE SET NULL,

  reviewed_at TIMESTAMPTZ,

  reviewer_comment TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 4. TASK STATUS HISTORY
-- ============================================================

CREATE TABLE IF NOT EXISTS task_status_history (
  id SERIAL PRIMARY KEY,

  task_id INT NOT NULL
    REFERENCES tasks(id)
    ON DELETE CASCADE,

  old_status VARCHAR(30),

  new_status VARCHAR(30) NOT NULL,

  changed_by INT
    REFERENCES employees(id)
    ON DELETE SET NULL,

  reason TEXT,

  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 5. ACCEPTANCE CRITERIA
-- ============================================================

CREATE TABLE IF NOT EXISTS task_acceptance_criteria (
  id SERIAL PRIMARY KEY,

  task_id INT NOT NULL
    REFERENCES tasks(id)
    ON DELETE CASCADE,

  criterion TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 6. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_tasks_task_type
ON tasks(task_type);

CREATE INDEX IF NOT EXISTS idx_task_completion_task
ON task_completion_submissions(task_id);

CREATE INDEX IF NOT EXISTS idx_task_completion_reviewer
ON task_completion_submissions(reviewed_by);

CREATE INDEX IF NOT EXISTS idx_task_status_history_task
ON task_status_history(task_id);

CREATE INDEX IF NOT EXISTS idx_task_acceptance_task
ON task_acceptance_criteria(task_id);


COMMIT;