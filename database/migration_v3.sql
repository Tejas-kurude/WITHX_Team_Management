-- WITHX Management Platform v3 migration
-- Run this ONCE on an existing withx_management database that was created by an older project version.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS id_counters (
  counter_key VARCHAR(30) PRIMARY KEY,
  last_value INT NOT NULL DEFAULT 0
);
INSERT INTO id_counters(counter_key,last_value) VALUES ('INTERN',0),('EMPLOYEE',0)
ON CONFLICT(counter_key) DO NOTHING;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_user_type_check;
ALTER TABLE employees ADD CONSTRAINT employees_user_type_check CHECK(user_type IN('INTERN','EMPLOYEE'));

ALTER TABLE departments ADD COLUMN IF NOT EXISTS head_employee_id INT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='departments_head_employee_id_fkey') THEN
    ALTER TABLE departments ADD CONSTRAINT departments_head_employee_id_fkey FOREIGN KEY(head_employee_id) REFERENCES employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Department deletion must be blocked while people remain assigned.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_department_id_fkey;
ALTER TABLE employees ADD CONSTRAINT employees_department_id_fkey FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE RESTRICT;

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS attendance_mode VARCHAR(20) NOT NULL DEFAULT 'OFFLINE';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS location_text TEXT;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_attendance_mode_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_attendance_mode_check CHECK(attendance_mode IN('ONLINE','OFFLINE'));

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_batch_id UUID;
UPDATE tasks SET assignment_batch_id=gen_random_uuid() WHERE assignment_batch_id IS NULL;
ALTER TABLE tasks ALTER COLUMN assignment_batch_id SET DEFAULT gen_random_uuid();
ALTER TABLE tasks ALTER COLUMN assignment_batch_id SET NOT NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignment_scope VARCHAR(30) NOT NULL DEFAULT 'INDIVIDUAL';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS scope_ref_id INT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assignment_scope_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_assignment_scope_check CHECK(assignment_scope IN('INDIVIDUAL','MULTIPLE','TEAM','DEPARTMENT'));

-- Normalize legacy task status names.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
UPDATE tasks SET status='PENDING' WHERE status='TO_DO';
UPDATE tasks SET status='IN_PROGRESS' WHERE status='REVIEW';
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK(status IN('PENDING','IN_PROGRESS','COMPLETED','BLOCKED','CANCELLED'));

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type VARCHAR(60);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_team_lead ON employees(team_lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(assignment_batch_id);

INSERT INTO system_settings(key,value) VALUES
('company_name','WITHX Innovations Private Limited'),
('office_address','MIT ACADEMY OF ENGINEERING, Kate Patil Nagar, Alandi, Maharashtra 412105'),
('office_latitude',''),
('office_longitude',''),
('geofence_radius_m','300'),
('late_after_time','10:15'),
('team_existing_tasks_for_new_members','NO')
ON CONFLICT(key) DO NOTHING;
