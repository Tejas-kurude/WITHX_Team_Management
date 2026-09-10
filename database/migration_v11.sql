BEGIN;

-- Connect Team Leads to an Admin. Members remain connected through team_lead_id.
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS admin_id INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employees_admin_id_fkey'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_admin_id_fkey
      FOREIGN KEY (admin_id)
      REFERENCES employees(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employees_admin_id
  ON employees(admin_id);

-- Add ADMIN as a valid task assignment scope.
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_assignment_scope_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_assignment_scope_check
  CHECK (assignment_scope IN ('INDIVIDUAL','MULTIPLE','TEAM','DEPARTMENT','ADMIN'));

COMMIT;
