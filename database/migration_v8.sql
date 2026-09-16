CREATE TABLE IF NOT EXISTS task_edit_history (
  id BIGSERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  edited_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changes JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_task_edit_history_task_time
  ON task_edit_history(task_id, edited_at DESC, id DESC);
