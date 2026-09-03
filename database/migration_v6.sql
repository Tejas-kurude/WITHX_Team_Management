BEGIN;

-- Keep task status values consistent across old and new databases.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
UPDATE tasks SET status='PENDING' WHERE status='TO_DO';
UPDATE tasks SET status='IN_PROGRESS' WHERE status='REVIEW';
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'PENDING';
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK(status IN(
  'PENDING','IN_PROGRESS','BLOCKED','SUBMITTED','NEEDS_CHANGES','COMPLETED','REJECTED','CANCELLED'
));

-- Proof can be a verified link or an uploaded file.
ALTER TABLE task_completion_submissions ADD COLUMN IF NOT EXISTS proof_file_name TEXT;
ALTER TABLE task_completion_submissions ADD COLUMN IF NOT EXISTS proof_file_path TEXT;
ALTER TABLE task_completion_submissions ALTER COLUMN proof_url DROP NOT NULL;
ALTER TABLE task_completion_submissions DROP CONSTRAINT IF EXISTS task_completion_submissions_proof_type_check;
ALTER TABLE task_completion_submissions ADD CONSTRAINT task_completion_submissions_proof_type_check
  CHECK(proof_type IN('GITHUB','GOOGLE_DRIVE','FILE'));

-- New performance criterion. Legacy columns are retained for safe compatibility
-- with existing records, but new calculations no longer use them.
ALTER TABLE performance_scores ADD COLUMN IF NOT EXISTS working_hours NUMERIC(5,2) NOT NULL DEFAULT 0;

INSERT INTO system_settings(key,value) VALUES('minimum_work_minutes','180')
ON CONFLICT(key) DO NOTHING;


-- Daily report approval hierarchy.
ALTER TABLE daily_reports DROP CONSTRAINT IF EXISTS daily_reports_review_status_check;
ALTER TABLE daily_reports ADD CONSTRAINT daily_reports_review_status_check CHECK(review_status IN(
  'PENDING','APPROVED_BY_TEAM_LEAD','APPROVED_BY_ADMIN','REVIEWED','NEEDS_CHANGES','REJECTED'
));

CREATE TABLE IF NOT EXISTS daily_report_reviews (
  id SERIAL PRIMARY KEY,
  report_id INT NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  reviewer_role VARCHAR(30) NOT NULL CHECK(reviewer_role IN('TEAM_LEAD','ADMIN','SUPER_ADMIN')),
  reviewer_id INT REFERENCES employees(id) ON DELETE SET NULL,
  decision VARCHAR(30) NOT NULL CHECK(decision IN('APPROVED','NEEDS_CHANGES','REJECTED','SKIPPED')),
  comment TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(report_id,reviewer_role)
);
CREATE INDEX IF NOT EXISTS idx_daily_report_reviews_report ON daily_report_reviews(report_id);

COMMIT;
