CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO departments(name,description) VALUES
('Management','Leadership and company operations'),
('Engineering','Product and software engineering'),
('Product Design','Product research and design'),
('Marketing','Marketing and communication')
ON CONFLICT(name) DO NOTHING;

INSERT INTO employees(employee_code,user_type,first_name,last_name,email,job_title,department_id,joining_date)
SELECT 'WX0001','EMPLOYEE','WITHX','Super Admin','admin@withx.local','Super Administrator',d.id,current_date
FROM departments d WHERE d.name='Management'
ON CONFLICT(email) DO NOTHING;

INSERT INTO users(email,password_hash,role,employee_id)
SELECT 'admin@withx.local', crypt('Admin@123', gen_salt('bf',12)), 'SUPER_ADMIN', e.id
FROM employees e WHERE e.email='admin@withx.local'
ON CONFLICT(email) DO NOTHING;

INSERT INTO system_settings(key,value) VALUES
('company_name','WITHX Innovations Private Limited'),
('office_address','MIT ACADEMY OF ENGINEERING, Kate Patil Nagar, Alandi, Maharashtra 412105'),
('office_latitude',''),
('office_longitude',''),
('geofence_radius_m','300'),
('work_start_time','10:00'),
('late_after_time','10:15'),
('team_existing_tasks_for_new_members','NO')
ON CONFLICT(key) DO NOTHING;
