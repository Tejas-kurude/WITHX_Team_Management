CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  description TEXT,
  head_employee_id INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS id_counters (
  counter_key VARCHAR(30) PRIMARY KEY,
  last_value INT NOT NULL DEFAULT 0
);
INSERT INTO id_counters(counter_key,last_value) VALUES ('INTERN',0),('EMPLOYEE',0)
ON CONFLICT(counter_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  employee_code VARCHAR(30) UNIQUE NOT NULL,
  user_type VARCHAR(20) NOT NULL DEFAULT 'EMPLOYEE' CHECK(user_type IN('INTERN','EMPLOYEE')),
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(180) UNIQUE NOT NULL,
  phone VARCHAR(30),
  job_title VARCHAR(120),
  department_id INT REFERENCES departments(id) ON DELETE RESTRICT,
  team_lead_id INT REFERENCES employees(id) ON DELETE SET NULL,
  admin_id INT REFERENCES employees(id) ON DELETE SET NULL,
  joining_date DATE NOT NULL DEFAULT current_date,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','INACTIVE')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_head_employee_id_fkey;
ALTER TABLE departments ADD CONSTRAINT departments_head_employee_id_fkey FOREIGN KEY(head_employee_id) REFERENCES employees(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(180) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL CHECK(role IN('SUPER_ADMIN','ADMIN','TEAM_LEAD','EMPLOYEE')),
  employee_id INT UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  assignment_batch_id UUID NOT NULL DEFAULT gen_random_uuid(),
  assignment_scope VARCHAR(30) NOT NULL DEFAULT 'INDIVIDUAL' CHECK(assignment_scope IN('INDIVIDUAL','MULTIPLE','TEAM','DEPARTMENT','ADMIN')),
  scope_ref_id INT,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  assigned_to INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_by INT REFERENCES employees(id) ON DELETE SET NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN('LOW','MEDIUM','HIGH','CRITICAL')),
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','IN_PROGRESS','COMPLETED','BLOCKED','CANCELLED')),
  progress INT NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  start_date DATE,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL DEFAULT current_date,
  status VARCHAR(20) NOT NULL CHECK(status IN('PRESENT','ABSENT','LEAVE','HALF_DAY','LATE')),
  attendance_mode VARCHAR(20) NOT NULL DEFAULT 'OFFLINE' CHECK(attendance_mode IN('ONLINE','OFFLINE')),
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  check_in_lat NUMERIC(10,7), check_in_lng NUMERIC(10,7),
  check_out_lat NUMERIC(10,7), check_out_lng NUMERIC(10,7),
  location_accuracy NUMERIC(10,2), location_verified BOOLEAN DEFAULT false,
  location_text TEXT,
  total_hours NUMERIC(6,2),
  notes TEXT,
  UNIQUE(employee_id,work_date)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  report_date DATE NOT NULL DEFAULT current_date,
  completed_work TEXT NOT NULL,
  tasks_worked TEXT,
  hours_worked NUMERIC(5,2),
  blockers TEXT,
  tomorrow_plan TEXT,
  comments TEXT,
  review_status VARCHAR(20) DEFAULT 'PENDING' CHECK(review_status IN('PENDING','REVIEWED','NEEDS_CHANGES')),
  review_comment TEXT,
  reviewed_by INT REFERENCES employees(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id,report_date)
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(30) NOT NULL CHECK(leave_type IN('PAID','SICK','UNPAID')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT NOT NULL,
  reference_link TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED')),
  reviewed_by INT REFERENCES employees(id) ON DELETE SET NULL,
  review_comment TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK(end_date>=start_date)
);

CREATE TABLE IF NOT EXISTS performance_scores (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  task_completion NUMERIC(5,2) NOT NULL,
  on_time NUMERIC(5,2) NOT NULL,
  attendance NUMERIC(5,2) NOT NULL,
  punctuality NUMERIC(5,2) NOT NULL,
  report_consistency NUMERIC(5,2) NOT NULL,
  working_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  required_work_hours NUMERIC(5,2) NOT NULL DEFAULT 3.00,
  score NUMERIC(5,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  entity_type VARCHAR(60),
  entity_id VARCHAR(80),
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id VARCHAR(80),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_settings (
  key VARCHAR(120) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_team_lead ON employees(team_lead_id);
CREATE INDEX IF NOT EXISTS idx_employees_admin_id ON employees(admin_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to,status);
CREATE INDEX IF NOT EXISTS idx_tasks_batch ON tasks(assignment_batch_id);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id,work_date DESC);
CREATE INDEX IF NOT EXISTS idx_reports_employee_date ON daily_reports(employee_id,report_date DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id,is_read,created_at DESC);
