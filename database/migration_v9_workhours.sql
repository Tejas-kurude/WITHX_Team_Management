CREATE TABLE IF NOT EXISTS work_hours_settings (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('DEFAULT','DEPARTMENT','TEAM','EMPLOYEE')),
  scope_id INTEGER NULL,
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  created_by INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_hours_default
  ON work_hours_settings(scope) WHERE scope='DEFAULT';

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_hours_scoped
  ON work_hours_settings(scope,scope_id) WHERE scope<>'DEFAULT';

CREATE INDEX IF NOT EXISTS idx_work_hours_scope_target
  ON work_hours_settings(scope,scope_id);

INSERT INTO work_hours_settings(scope,scope_id,hours)
SELECT 'DEFAULT',NULL,3.00
WHERE NOT EXISTS (SELECT 1 FROM work_hours_settings WHERE scope='DEFAULT');
