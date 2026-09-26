import { randomUUID, createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { pool, query } from '../config/db.js';
import { audit } from '../services/audit.js';
import { haversineMeters } from '../utils/geo.js';

const isAdmin = (role?: string) => ['SUPER_ADMIN', 'ADMIN'].includes(role || '');
const isManager = (role?: string) => ['SUPER_ADMIN', 'ADMIN', 'TEAM_LEAD'].includes(role || '');
const numOrNull = (v: any) => v === '' || v === undefined || v === null ? null : Number(v);
const textOrNull = (v: any) => v === '' || v === undefined || v === null ? null : String(v);

// At 11:59 PM, finalize today's attendance for active employees who never
// checked in. Approved leave is excluded, and Sundays are not working days.
export async function markEndOfDayAbsences() {
  try {
    const clock = await query<any>(
      `SELECT current_date::text AS work_date,
              EXTRACT(HOUR FROM current_time)::int AS hour,
              EXTRACT(MINUTE FROM current_time)::int AS minute,
              EXTRACT(DOW FROM current_date)::int AS dow`
    );

    const row = clock.rows[0];

    // Run only at 11:59 PM. PostgreSQL provides the authoritative date/time.
    if (!row || row.hour !== 23 || row.minute !== 59 || row.dow === 0) {
      return;
    }

    await query(
      `INSERT INTO attendance(
         employee_id,
         work_date,
         status,
         attendance_mode,
         location_text,
         required_work_hours
       )
       SELECT
         e.id,
         $1::date,
         'ABSENT',
         'OFFLINE',
         'Auto-marked absent at end of day',
         COALESCE(
           (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=$1::date AND dwh.scope='EMPLOYEE' AND dwh.scope_id=e.id ORDER BY dwh.id DESC LIMIT 1),
           (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=$1::date AND dwh.scope='TEAM' AND dwh.scope_id=e.team_lead_id ORDER BY dwh.id DESC LIMIT 1),
           (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=$1::date AND dwh.scope='DEPARTMENT' AND dwh.scope_id=e.department_id ORDER BY dwh.id DESC LIMIT 1),
           (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=$1::date AND dwh.scope='DEFAULT' ORDER BY dwh.id DESC LIMIT 1),
           (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='EMPLOYEE' AND wh.scope_id=e.id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
           (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='TEAM' AND wh.scope_id=e.team_lead_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
           (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEPARTMENT' AND wh.scope_id=e.department_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
           (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEFAULT' ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
           (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'performance_default_daily_required_minutes' LIMIT 1),
           (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'minimum_work_minutes' LIMIT 1),
           8.00
         )
       FROM employees e
       LEFT JOIN attendance a
         ON a.employee_id = e.id
        AND a.work_date = $1::date
       WHERE e.status = 'ACTIVE'
         AND a.id IS NULL
         AND NOT EXISTS (
           SELECT 1
           FROM leave_requests lr
           WHERE lr.employee_id = e.id
             AND lr.status = 'APPROVED'
             AND lr.start_date <= $1::date
             AND lr.end_date >= $1::date
         )
       ON CONFLICT(employee_id, work_date) DO NOTHING`,
      [row.work_date]
    );
  } catch (error) {
    console.error('End-of-day attendance finalization failed:', error);
  }
}


async function saveProfilePhoto(fileName: any, fileData: any) {
  if (!fileName || !fileData) return null;

  const match = String(fileData).match(
    /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/
  );

  if (!match) {
    throw new Error('Profile photo must be JPG, PNG or WEBP.');
  }

  const bytes = Buffer.from(match[2], 'base64');

  if (bytes.length > 2 * 1024 * 1024) {
    throw new Error('Profile photo must be 2 MB or smaller.');
  }

  const safeOriginal = path
    .basename(String(fileName))
    .replace(/[^a-zA-Z0-9._-]/g, '_');

  const storedName = `${Date.now()}-${randomUUID()}-${safeOriginal}`;
  const uploadDir = path.resolve(process.cwd(), 'uploads', 'profile-photos');

  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, storedName), bytes);

  return `/uploads/profile-photos/${storedName}`;
}

function passwordEncryptionKey() {
  const raw = process.env.PASSWORD_ENCRYPTION_KEY || '';
  if (!raw) throw new Error('PASSWORD_ENCRYPTION_KEY is not configured.');
  return createHash('sha256').update(raw).digest();
}

function encryptPassword(password: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', passwordEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptPassword(payload: string | null | undefined) {
  if (!payload) return null;
  const [ivB64, tagB64, encryptedB64] = String(payload).split(':');
  if (!ivB64 || !tagB64 || !encryptedB64) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', passwordEncryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

async function isTeamMember(teamLeadId: number | null, employeeId: number) {
  if (!teamLeadId) return false;
  const r = await query<any>('SELECT 1 FROM employees WHERE id=$1 AND team_lead_id=$2', [employeeId, teamLeadId]);
  return !!r.rows[0];
}

async function isEmployeeInAdminHierarchy(adminId: number | null, employeeId: number | null) {
  if (!adminId || !employeeId) return false;
  const r = await query<any>(`
    SELECT 1
    FROM employees e
    WHERE e.id = $1
      AND (
        e.id = $2
        OR e.admin_id = $2
        OR e.team_lead_id IN (
          SELECT tl.id
          FROM employees tl
          WHERE tl.admin_id = $2
        )
      )
    LIMIT 1`,
    [employeeId, adminId]
  );
  return !!r.rows[0];
}

async function requireTeamAuthority(req: Request, employeeId: number) {
  if (req.user!.role !== 'TEAM_LEAD') return true;
  return employeeId === req.user!.employeeId || await isTeamMember(req.user!.employeeId, employeeId);
}

async function nextUserCode(client: any, userType: 'INTERN' | 'EMPLOYEE') {
  const key = userType;
  const r = await client.query(
    `INSERT INTO id_counters(counter_key,last_value) VALUES($1,1)
     ON CONFLICT(counter_key) DO UPDATE SET last_value=id_counters.last_value+1
     RETURNING last_value`, [key]
  );
  const prefix = userType === 'INTERN' ? 'INT' : 'EMP';
  return `${prefix}${String(r.rows[0].last_value).padStart(3, '0')}`;
}

async function syncDeadlineNotifications(employeeId?: number | null) {
  const params: any[] = [];
  let scope = '';
  if (employeeId) { params.push(employeeId); scope = ` AND t.assigned_to=$1`; }
  await query(`
    INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id)
    SELECT t.assigned_to,'TASK_DEADLINE','Task deadline approaching',
           t.title || ' is due ' || to_char(t.due_date,'DD Mon YYYY HH24:MI'),'TASK',t.id::text
    FROM tasks t
    WHERE t.due_date IS NOT NULL
      AND t.due_date > now() AND t.due_date <= now()+interval '24 hours'
      AND t.status NOT IN ('COMPLETED','CANCELLED','DRAFT') ${scope}
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.employee_id=t.assigned_to AND n.type='TASK_DEADLINE' AND n.entity_type='TASK' AND n.entity_id=t.id::text
      )`, params);
  await query(`
    INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id)
    SELECT t.assigned_to,'TASK_OVERDUE','Task overdue',t.title || ' is overdue.','TASK',t.id::text
    FROM tasks t
    WHERE t.due_date IS NOT NULL AND t.due_date < now()
      AND t.status NOT IN ('COMPLETED','CANCELLED','DRAFT') ${scope}
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.employee_id=t.assigned_to AND n.type='TASK_OVERDUE' AND n.entity_type='TASK' AND n.entity_id=t.id::text
      )`, params);
}

export async function dashboard(req: Request, res: Response) {
  const role = req.user!.role, emp = req.user!.employeeId;
  if (role === 'EMPLOYEE') {
    const [task, att, rep, perf, leave] = await Promise.all([
      query<any>(`SELECT count(*)::int total,count(*) FILTER(WHERE status='COMPLETED')::int completed,count(*) FILTER(WHERE due_date<now() AND status NOT IN ('COMPLETED','CANCELLED','DRAFT'))::int overdue FROM tasks WHERE assigned_to=$1`, [emp]),
      query<any>(`SELECT status,attendance_mode,check_in,check_out FROM attendance WHERE employee_id=$1 AND work_date=current_date`, [emp]),
      query<any>(`SELECT count(*)::int submitted FROM daily_reports WHERE employee_id=$1 AND report_date>=date_trunc('month',current_date)`, [emp]),
      query<any>(`SELECT score,task_completion,attendance,working_hours FROM performance_scores WHERE employee_id=$1 ORDER BY period_end DESC LIMIT 1`, [emp]),
      query<any>(`SELECT count(*) FILTER(WHERE status='PENDING')::int pending FROM leave_requests WHERE employee_id=$1`, [emp])
    ]);
    return res.json({ scope: 'employee', tasks: task.rows[0], todayAttendance: att.rows[0] || null, reports: rep.rows[0], performance: perf.rows[0] || null, leave: leave.rows[0] });
  }
  const team = role === 'TEAM_LEAD';
  const params = team ? [emp] : [];
  const employeeWhere = team ? 'WHERE e.team_lead_id=$1' : 'WHERE 1=1';
  const joinTeam = team ? ' AND e.team_lead_id=$1' : '';
  const [employees, attendance, tasks, depts, activities, presentToday] = await Promise.all([
    query<any>(`SELECT count(*)::int total,count(*) FILTER(WHERE e.status='ACTIVE')::int active,count(*) FILTER(WHERE e.user_type='INTERN')::int interns,count(*) FILTER(WHERE e.user_type='EMPLOYEE')::int employees FROM employees e ${employeeWhere}`, params),
    query<any>(`SELECT count(*) FILTER(WHERE a.status IN('PRESENT','LATE'))::int present,count(*) FILTER(WHERE a.status='LATE')::int late,count(*) FILTER(WHERE a.status='LEAVE')::int leave FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.work_date=current_date ${joinTeam}`, params),
    query<any>(`SELECT count(*)::int total,count(*) FILTER(WHERE t.status='COMPLETED')::int completed,count(*) FILTER(WHERE t.due_date<now() AND t.status NOT IN ('COMPLETED','CANCELLED','DRAFT'))::int overdue,count(*) FILTER(WHERE t.status='PENDING')::int pending FROM tasks t JOIN employees e ON e.id=t.assigned_to WHERE 1=1 ${joinTeam}`, params),
    team ? query<any>(`SELECT count(DISTINCT department_id)::int total FROM employees WHERE team_lead_id=$1 AND department_id IS NOT NULL`, [emp]) : query<any>('SELECT count(*)::int total FROM departments'),
    isAdmin(role) ? query<any>('SELECT al.id,al.action,al.entity_type,al.created_at,u.email FROM activity_logs al LEFT JOIN users u ON u.id=al.user_id ORDER BY al.created_at DESC LIMIT 8') : Promise.resolve({ rows: [] } as any),
    query<any>(`
      SELECT
        e.id,
        e.employee_code,
        e.first_name || ' ' || e.last_name AS employee_name,
        e.user_type,
        a.status,
        a.check_in,
        a.check_out
      FROM attendance a
      JOIN employees e ON e.id = a.employee_id
      WHERE a.work_date = current_date
        AND a.status IN ('PRESENT','LATE')
        ${joinTeam}
      ORDER BY e.first_name, e.last_name
    `, params)
  ]);
  res.json({
    scope: role.toLowerCase(),
    employees: employees.rows[0],
    attendance: attendance.rows[0],
    tasks: tasks.rows[0],
    departments: depts.rows[0],
    recentActivity: activities.rows,
    presentToday: presentToday.rows
  });
}

export async function listDepartments(req: Request, res: Response) {
  const { search = '' } = req.query as any;
  const p: any[] = [];
  let filter = '';
  if (search) { p.push(`%${search}%`); filter = `WHERE d.name ILIKE $1 OR d.description ILIKE $1`; }
  const r = await query<any>(`
    SELECT d.*,h.first_name||' '||h.last_name head_name,
           count(e.id)::int member_count,
           count(e.id) FILTER(WHERE e.user_type='INTERN')::int intern_count,
           count(e.id) FILTER(WHERE e.user_type='EMPLOYEE')::int employee_count
    FROM departments d
    LEFT JOIN employees h ON h.id=d.head_employee_id
    LEFT JOIN employees e ON e.department_id=d.id
    ${filter}
    GROUP BY d.id,h.first_name,h.last_name
    ORDER BY d.name`, p);
  res.json(r.rows);
}
export async function getDepartment(req: Request, res: Response) {
  const id = Number(req.params.id);
  const d = await query<any>(`SELECT d.*,h.first_name||' '||h.last_name head_name FROM departments d LEFT JOIN employees h ON h.id=d.head_employee_id WHERE d.id=$1`, [id]);
  if (!d.rows[0]) return res.status(404).json({ message: 'Department not found' });
  const p: any[] = [id];
  let teamFilter = '';
  if (req.user!.role === 'TEAM_LEAD') { p.push(req.user!.employeeId); teamFilter = ' AND e.team_lead_id=$2'; }
  const members = await query<any>(`SELECT e.*,u.role,tl.first_name||' '||tl.last_name team_lead_name FROM employees e LEFT JOIN users u ON u.employee_id=e.id LEFT JOIN employees tl ON tl.id=e.team_lead_id WHERE e.department_id=$1 ${teamFilter} ORDER BY e.first_name,e.last_name`, p);
  res.json({ ...d.rows[0], members: members.rows });
}
export async function createDepartment(req: Request, res: Response) {
  const { name, description, headEmployeeId } = req.body;
  if (!name) return res.status(400).json({ message: 'Name required' });
  const r = await query<any>('INSERT INTO departments(name,description,head_employee_id) VALUES($1,$2,$3) RETURNING *', [name, textOrNull(description), numOrNull(headEmployeeId)]);
  await audit(req.user?.userId, 'CREATE', 'DEPARTMENT', r.rows[0].id, { name });
  res.status(201).json(r.rows[0]);
}
export async function updateDepartment(req: Request, res: Response) {
  const { name, description, headEmployeeId } = req.body;
  const r = await query<any>(`UPDATE departments SET name=COALESCE($1,name),description=$2,head_employee_id=$3,updated_at=now() WHERE id=$4 RETURNING *`, [name || null, textOrNull(description), numOrNull(headEmployeeId), Number(req.params.id)]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Department not found' });
  await audit(req.user?.userId, 'UPDATE', 'DEPARTMENT', String(req.params.id), req.body);
  res.json(r.rows[0]);
}
export async function deleteDepartment(req: Request, res: Response) {
  const id = Number(req.params.id);
  const c = await query<any>('SELECT count(*)::int count FROM employees WHERE department_id=$1', [id]);
  if (c.rows[0].count > 0) return res.status(409).json({ message: `This department still has ${c.rows[0].count} employee/intern record(s). Reassign them before deleting the department.` });
  const r = await query<any>('DELETE FROM departments WHERE id=$1 RETURNING id,name', [id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Department not found' });
  await audit(req.user?.userId, 'DELETE', 'DEPARTMENT', id, { name: r.rows[0].name });
  res.json({ ok: true });
}

export async function listEmployees(req: Request, res: Response) {
  const { search = '', department = '', status = '', userType = '', role = '', teamLeadId = '' } = req.query as any;
  const p: any[] = []; let where = 'WHERE 1=1';
  if (req.user!.role === 'TEAM_LEAD') {
    p.push(req.user!.employeeId);
    where += ` AND (e.id=$${p.length} OR e.team_lead_id=$${p.length})`;
  } else if (req.user!.role === 'EMPLOYEE') {
    // If an employee calls listEmployees, restrict to active employees
    where += ` AND e.status = 'ACTIVE'`;
  }
  if (search) { p.push(`%${search}%`); where += ` AND (e.first_name ILIKE $${p.length} OR e.last_name ILIKE $${p.length} OR e.employee_code ILIKE $${p.length} OR e.email ILIKE $${p.length})`; }
  if (department) { p.push(Number(department)); where += ` AND e.department_id=$${p.length}`; }
  if (status) { p.push(status); where += ` AND e.status=$${p.length}`; }
  if (userType) { p.push(userType); where += ` AND e.user_type=$${p.length}`; }
  if (role) { p.push(role); where += ` AND u.role=$${p.length}`; }
  if (teamLeadId && req.user!.role !== 'TEAM_LEAD') { p.push(Number(teamLeadId)); where += ` AND e.team_lead_id=$${p.length}`; }
  const r = await query<any>(`SELECT e.*,d.name department_name,tl.first_name||' '||tl.last_name team_lead_name,
    COALESCE(
      ad.first_name||' '||ad.last_name,
      team_admin.first_name||' '||team_admin.last_name
    ) AS admin_name,
    u.role,u.password_encrypted
    FROM employees e
    LEFT JOIN departments d ON d.id=e.department_id
    LEFT JOIN employees tl ON tl.id=e.team_lead_id
    LEFT JOIN employees ad ON ad.id=e.admin_id
    LEFT JOIN employees team_admin ON team_admin.id=tl.admin_id
    LEFT JOIN users u ON u.employee_id=e.id
    ${where}
    ORDER BY e.created_at DESC`, p);
  res.json(r.rows.map((row: any) => {
    const { password_encrypted, ...safeRow } = row;
    return req.user!.role === 'SUPER_ADMIN'
      ? { ...safeRow, login_password: decryptPassword(password_encrypted) }
      : safeRow;
  }));
}
export async function getEmployee(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (req.user!.role === 'EMPLOYEE' && req.user!.employeeId !== id) return res.status(403).json({ message: 'Forbidden' });
  if (req.user!.role === 'TEAM_LEAD' && !(await requireTeamAuthority(req, id))) return res.status(403).json({ message: 'This person is outside your team.' });
  const r = await query<any>(`SELECT e.*,d.name department_name,tl.first_name||' '||tl.last_name team_lead_name,u.role FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees tl ON tl.id=e.team_lead_id LEFT JOIN users u ON u.employee_id=e.id WHERE e.id=$1`, [id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Employee not found' });
  
  res.json(r.rows[0]);
}
export async function createEmployee(req: Request, res: Response) {
  const {
    firstName,
    lastName,
    email,
    phone,
    jobTitle,
    departmentId,
    role = 'EMPLOYEE',
    joiningDate,
    password,
    teamLeadId,
    adminId,
    userType = 'EMPLOYEE',
    photoUrl,
    photoFileName,
    photoFileData
  } = req.body;
  if (!firstName || !lastName || !email || !password) return res.status(400).json({ message: 'First name, last name, email and password are required' });
  if (!['INTERN', 'EMPLOYEE'].includes(userType)) return res.status(400).json({ message: 'User type must be INTERN or EMPLOYEE' });
  if (!['EMPLOYEE', 'TEAM_LEAD', 'ADMIN', 'SUPER_ADMIN'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
  if (req.user!.role === 'ADMIN' && ['ADMIN', 'SUPER_ADMIN'].includes(role)) return res.status(403).json({ message: 'Only Super Admin can create Admin or Super Admin accounts.' });

  const parsedAdminId = numOrNull(adminId);
  if (role === 'TEAM_LEAD') {
    if (!parsedAdminId) return res.status(400).json({ message: 'Please assign an Admin to the Team Lead.' });
  }

  let savedPhotoUrl: string | null = textOrNull(photoUrl);

  if (photoFileName && photoFileData) {
    try {
      savedPhotoUrl = await saveProfilePhoto(
        photoFileName,
        photoFileData
      );
    } catch (error: any) {
      return res.status(400).json({
        message: error?.message || 'Unable to save profile photo.'
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (role === 'TEAM_LEAD') {
      const adminCheck = await client.query<any>(`
        SELECT e.id
        FROM employees e
        JOIN users u ON u.employee_id=e.id
        WHERE e.id=$1
          AND u.role='ADMIN'
          AND u.is_active=true
          AND e.status='ACTIVE'
        LIMIT 1`,
        [parsedAdminId]
      );
      if (!adminCheck.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Selected Admin is not a valid active Admin account.' });
      }
    }

    const code = await nextUserCode(client, userType);
    const e = await client.query<any>(
      `INSERT INTO employees(
        employee_code,
        user_type,
        first_name,
        last_name,
        email,
        phone,
        job_title,
        department_id,
        joining_date,
        team_lead_id,
        admin_id,
        photo_url
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [
        code,
        userType,
        firstName,
        lastName,
        email,
        textOrNull(phone),
        textOrNull(jobTitle),
        numOrNull(departmentId),
        joiningDate || new Date().toISOString().slice(0, 10),
        numOrNull(teamLeadId),
        role === 'TEAM_LEAD' ? parsedAdminId : null,
        savedPhotoUrl
      ]
    );
    const hash = await bcrypt.hash(password, 12);
    const encryptedPassword = encryptPassword(password);
    await client.query('INSERT INTO users(email,password_hash,password_encrypted,role,employee_id) VALUES($1,$2,$3,$4,$5)', [email, hash, encryptedPassword, role, e.rows[0].id]);
    await client.query('COMMIT');
    await audit(req.user?.userId, 'CREATE', userType, e.rows[0].id, { code, email, role, departmentId, teamLeadId, adminId: role === 'TEAM_LEAD' ? parsedAdminId : null });
    res.status(201).json(e.rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') return res.status(409).json({ message: 'An account with this email or generated ID already exists.' });
    throw err;
  } finally { client.release(); }
}

export async function updateEmployee(req: Request, res: Response) {
  const id = Number(req.params.id), b = req.body;

  const existing = await query<any>(`
    SELECT e.*, u.role
    FROM employees e
    LEFT JOIN users u ON u.employee_id=e.id
    WHERE e.id=$1
    LIMIT 1`,
    [id]
  );
  if (!existing.rows[0]) return res.status(404).json({ message: 'Employee not found' });

  const effectiveRole = String(b.role || existing.rows[0].role || 'EMPLOYEE').toUpperCase();
  const parsedAdminId = numOrNull(b.adminId);

  if (effectiveRole === 'TEAM_LEAD') {
    if (!parsedAdminId) return res.status(400).json({ message: 'Please assign an Admin to the Team Lead.' });
    const adminCheck = await query<any>(`
      SELECT e.id
      FROM employees e
      JOIN users u ON u.employee_id=e.id
      WHERE e.id=$1
        AND u.role='ADMIN'
        AND u.is_active=true
        AND e.status='ACTIVE'
      LIMIT 1`,
      [parsedAdminId]
    );
    if (!adminCheck.rows[0]) return res.status(400).json({ message: 'Selected Admin is not a valid active Admin account.' });
  }

  let newPhotoUrl: string | null = null;

  if (b.photoFileName && b.photoFileData) {
    try {
      newPhotoUrl = await saveProfilePhoto(
        b.photoFileName,
        b.photoFileData
      );
    } catch (error: any) {
      return res.status(400).json({
        message: error?.message || 'Unable to save profile photo.'
      });
    }
  } else if (b.photoUrl !== undefined) {
    newPhotoUrl = textOrNull(b.photoUrl);
  }

  const r = await query<any>(
    `UPDATE employees
     SET first_name=COALESCE($1,first_name),
         last_name=COALESCE($2,last_name),
         email=COALESCE($3,email),
         phone=$4,
         job_title=$5,
         department_id=$6,
         team_lead_id=$7,
         admin_id=$8,
         status=COALESCE($9,status),
         photo_url=COALESCE($10::text, photo_url),
         updated_at=now()
     WHERE id=$11
     RETURNING *`,
    [
      b.firstName || null,
      b.lastName || null,
      textOrNull(b.email),
      textOrNull(b.phone),
      textOrNull(b.jobTitle),
      numOrNull(b.departmentId),
      numOrNull(b.teamLeadId),
      effectiveRole === 'TEAM_LEAD' ? parsedAdminId : null,
      b.status || null,
      newPhotoUrl,
      id
    ]
  );
  if (!r.rows[0]) return res.status(404).json({ message: 'Employee not found' });
  // Update login role in users table
const roleUpdate = await query<any>(
  `UPDATE users
   SET role = $1
   WHERE employee_id = $2
   RETURNING id, role`,
  [effectiveRole, id]
);

if (!roleUpdate.rows[0]) {
  return res.status(404).json({
    message: 'Employee account not found.'
  });
}

  // Keep the login email synchronized with the employee profile email.
  if (b.email !== undefined && String(b.email).trim()) {
    await query<any>(
      `UPDATE users
       SET email = $1
       WHERE employee_id = $2`,
      [String(b.email).trim(), id]
    );
  }

  if (b.password !== undefined && String(b.password).trim()) {
    const password = String(b.password);
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    const hash = await bcrypt.hash(password, 12);
    const encryptedPassword = encryptPassword(password);
    const u = await query<any>('UPDATE users SET password_hash=$1,password_encrypted=$2 WHERE employee_id=$3 RETURNING id', [hash, encryptedPassword, id]);
    if (!u.rows[0]) return res.status(404).json({ message: 'Employee account not found.' });
  }

  await audit(req.user?.userId, 'UPDATE', 'EMPLOYEE', id, { ...b, adminId: effectiveRole === 'TEAM_LEAD' ? parsedAdminId : null, password: b.password ? '[updated]' : undefined });
  res.json(r.rows[0]);
}
export async function deleteEmployee(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);

    await query(
      `DELETE FROM task_completion_submissions
       WHERE submitted_by = $1`,
      [id]
    );

    const r = await query<any>(
      `DELETE FROM employees
       WHERE id = $1
       RETURNING id, email, employee_code`,
      [id]
    );

    if (!r.rows[0]) {
      return res.status(404).json({
        message: 'Employee not found',
      });
    }

    await audit(
      req.user?.userId,
      'DELETE',
      'EMPLOYEE',
      id,
      {
        email: r.rows[0].email,
        employeeCode: r.rows[0].employee_code,
      }
    );

    return res.json({ ok: true });
  } catch (error: any) {
    console.error('Error deleting employee:', error);

    return res.status(500).json({
      message: error.message || 'Employee deletion failed',
    });
  }
}

function normalizeTaskEditValue(value: any) {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function buildTaskEditChanges(before: any, after: any) {
  const fields: Array<[string, string]> = [
    ['title', 'Title'],
    ['description', 'Description'],
    ['assigned_to', 'Assigned To'],
    ['priority', 'Priority'],
    ['task_type', 'Task Type'],
    ['start_date', 'Start Date'],
    ['due_date', 'End Date'],
    ['status', 'Status'],
    ['progress', 'Progress'],
    ['attachment_url', 'Attachment'],
  ];
  const changes: Record<string, { label: string; oldValue: any; newValue: any }> = {};
  for (const [field, label] of fields) {
    const oldValue = normalizeTaskEditValue(before?.[field]);
    const newValue = normalizeTaskEditValue(after?.[field]);
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes[field] = { label, oldValue, newValue };
    }
  }
  return changes;
}

export async function listTasks(req: Request, res: Response) {
  await syncDeadlineNotifications(req.user!.role === 'EMPLOYEE' ? req.user!.employeeId : null);
  const { search = '', status = '', statusGroup = '', priority = '', department = '', employeeId = '', teamLeadId = '', date = '' } = req.query as any;
  const p: any[] = []; let w = 'WHERE 1=1';
  if (req.user!.role === 'EMPLOYEE') { p.push(req.user!.employeeId); w += ` AND t.assigned_to=$${p.length}`; }
  else if (req.user!.role === 'TEAM_LEAD') { p.push(req.user!.employeeId); w += ` AND (t.assigned_to=$${p.length} OR e.team_lead_id=$${p.length})`; }
  else if (req.user!.role === 'ADMIN') {
    p.push(req.user!.employeeId);
    const adminParam = p.length;
    w += ` AND (
      t.assigned_to=$${adminParam}
      OR e.id IN (SELECT tl.id FROM employees tl WHERE tl.admin_id=$${adminParam})
      OR e.team_lead_id IN (SELECT tl.id FROM employees tl WHERE tl.admin_id=$${adminParam})
    )`;
  }
  if (search) { p.push(`%${search}%`); w += ` AND (t.title ILIKE $${p.length} OR t.description ILIKE $${p.length} OR e.first_name ILIKE $${p.length} OR e.last_name ILIKE $${p.length})`; }

  // Drafts are private to their creator and live only in the Drafts view.
  if (status === 'DRAFT') {
    p.push(req.user!.employeeId);
    w += ` AND t.status = 'DRAFT' AND t.created_by = $${p.length}`;
  } else if (!status) {
    // Never expose drafts through the normal Tasks view.
    w += ` AND t.status <> 'DRAFT'`;
  }

  // Active / Pending vs Completed vs Rejected segmentation
  if (statusGroup === 'completed' || statusGroup === 'past') {
    w += ` AND t.status = 'COMPLETED'`;
  } else if (statusGroup === 'rejected') {
    w += ` AND t.status = 'REJECTED'`;
  } else if ((statusGroup === 'pending' || statusGroup === 'active') && !status) {
    w += ` AND t.status NOT IN ('COMPLETED', 'REJECTED', 'DRAFT')`;
  }

  if (status) {
    if (status === 'OVERDUE') w += ` AND t.due_date<now() AND t.status NOT IN ('COMPLETED','REJECTED','CANCELLED','DRAFT')`;
    else if (status !== 'DRAFT') { p.push(status); w += ` AND t.status=$${p.length}`; }
  }
  if (priority) { p.push(priority); w += ` AND t.priority=$${p.length}`; }
  if (department) { p.push(Number(department)); w += ` AND e.department_id=$${p.length}`; }
  if (employeeId) { p.push(Number(employeeId)); w += ` AND t.assigned_to=$${p.length}`; }
  if (teamLeadId) { p.push(Number(teamLeadId)); w += ` AND (e.team_lead_id=$${p.length} OR e.id=$${p.length})`; }
  if (date) { p.push(date); w += ` AND t.created_at::date=$${p.length}::date`; }
const r = await query<any>(
  `
  SELECT
    t.*,
    (
  SELECT COUNT(*)::int
  FROM task_reviews tr_history
  WHERE tr_history.task_id = t.id
    AND tr_history.decision = 'NEEDS_CHANGES'
) AS needs_changes_count,

    e.employee_code,
    e.user_type,
    e.first_name || ' ' || e.last_name AS assignee_name,

    d.name AS department_name,

    tl.first_name || ' ' || tl.last_name AS team_lead_name,

    c.first_name || ' ' || c.last_name AS creator_name,

    latest_edit.edited_at AS latest_edit_at,
    latest_edit.editor_name AS latest_edit_by,
    (latest_edit.id IS NOT NULL) AS is_edited,

    /*
     * =====================================================
     * LATEST COMPLETION SUBMISSION
     * =====================================================
     */

    cs.id AS completion_submission_id,
    cs.completion_summary,
    cs.proof_type,
    cs.proof_url,
    cs.proof_file_name,
    cs.proof_file_path,
    cs.submitted_at AS completion_submitted_at,

    /*
     * Old submission review fields.
     * Kept for backward compatibility.
     */

    cs.review_decision,
    cs.reviewed_by,
    cs.reviewed_at,
    cs.reviewer_comment,

    /*
     * =====================================================
     * TEAM LEAD REVIEW
     * =====================================================
     */



CASE
  WHEN lead_review.decision = 'REJECTED'
    THEN 'REJECTED'
  ELSE lead_review.decision
END AS lead_review_decision,

lead_review.comment
  AS lead_review_comment,

lead_review.reviewed_at
  AS lead_reviewed_at,

lead_review.reviewer_id
  AS lead_reviewer_id,

CASE
  WHEN lead_reviewer.id IS NOT NULL
  THEN
    lead_reviewer.first_name || ' ' ||
    lead_reviewer.last_name
  ELSE NULL
END AS lead_reviewer_name,

    /*
     * =====================================================
     * ADMIN REVIEW
     * =====================================================
     */
/*
 * =====================================================
 * ADMIN REVIEW
 * =====================================================
 */

CASE
  /*
   * Team Lead rejection propagates upward.
   */
  WHEN lead_review.decision = 'REJECTED'
    THEN 'REJECTED'

  /*
   * Otherwise show Admin's actual decision.
   */
  WHEN admin_review.decision IS NOT NULL
    THEN admin_review.decision

  ELSE NULL
END AS admin_review_decision,

admin_review.comment
  AS admin_review_comment,

admin_review.reviewed_at
  AS admin_reviewed_at,

admin_review.reviewer_id
  AS admin_reviewer_id,

CASE
  /*
   * If rejection came from Team Lead,
   * show the Team Lead as the rejection source.
   */
  WHEN lead_review.decision = 'REJECTED'
    THEN
      lead_reviewer.first_name || ' ' ||
      lead_reviewer.last_name

  WHEN admin_reviewer.id IS NOT NULL
    THEN
      admin_reviewer.first_name || ' ' ||
      admin_reviewer.last_name

  ELSE NULL
END AS admin_reviewer_name,


/*
 * =====================================================
 * SUPER ADMIN REVIEW
 * =====================================================
 */

CASE
  /*
   * Team Lead rejection propagates to Super Admin.
   */
  WHEN lead_review.decision = 'REJECTED'
    THEN 'REJECTED'

  /*
   * Admin rejection propagates to Super Admin.
   */
  WHEN admin_review.decision = 'REJECTED'
    THEN 'REJECTED'

  /*
   * Otherwise show Super Admin's actual decision.
   */
  WHEN super_review.decision IS NOT NULL
    THEN super_review.decision

  ELSE NULL
END AS super_admin_review_decision,

super_review.comment
  AS super_admin_review_comment,

super_review.reviewed_at
  AS super_admin_reviewed_at,

super_review.reviewer_id
  AS super_admin_reviewer_id,

CASE
  /*
   * Find who actually caused the rejection.
   */
  WHEN lead_review.decision = 'REJECTED'
    THEN
      lead_reviewer.first_name || ' ' ||
      lead_reviewer.last_name

  WHEN admin_review.decision = 'REJECTED'
    THEN
      admin_reviewer.first_name || ' ' ||
      admin_reviewer.last_name

  WHEN super_reviewer.id IS NOT NULL
    THEN
      super_reviewer.first_name || ' ' ||
      super_reviewer.last_name

  ELSE NULL
END AS super_admin_reviewer_name,

/*
 * =====================================================
 * CURRENT USER'S REVIEW
 * =====================================================
 *
 * Each hierarchy level can review independently.
 *
 * REJECT / NEEDS_CHANGES closes the review cycle.
 * APPROVAL does NOT block the other hierarchy levels.
 */

CASE
  /*
   * No one can review a closed task.
   */
  WHEN t.status IN (
    'REJECTED',
    'NEEDS_CHANGES',
    'CANCELLED'
  )
  THEN false
  WHEN t.status = 'COMPLETED' AND (super_review.decision = 'APPROVED' OR super_review.decision = 'APPROVE')
  THEN false
  WHEN t.status NOT IN ('SUBMITTED', 'COMPLETED') AND COALESCE(t.progress, 0) < 100
  THEN false

  /*
   * TEAM LEAD
   *
   * Team Lead can review while their own review
   * is still PENDING.
   */
  WHEN $${p.length + 1}::varchar = 'TEAM_LEAD'
   AND (lead_review.decision = 'PENDING' OR lead_review.decision IS NULL)
   AND e.team_lead_id = $${p.length + 2}::integer
  THEN true

  /*
   * ADMIN
   *
   * Admin can review independently.
   * Team Lead does NOT have to approve first.
   */
  WHEN $${p.length + 1}::varchar = 'ADMIN'
   AND (admin_review.decision = 'PENDING' OR admin_review.decision IS NULL)
  THEN true

  /*
   * SUPER ADMIN
   *
   * Super Admin can review independently.
   * Team Lead/Admin do NOT have to approve first.
   */
  WHEN $${p.length + 1}::varchar = 'SUPER_ADMIN'
   AND (super_review.decision = 'PENDING' OR super_review.decision IS NULL)
  THEN true

  ELSE false
END AS can_review,
    /*
     * =====================================================
     * HIERARCHY STATUS
     * =====================================================
     */

CASE

  /*
   * Highest actual approval always wins.
   */
  WHEN super_review.decision = 'APPROVED'
    THEN 'APPROVED_BY_SUPER_ADMIN'

  /*
   * Super Admin has not acted, but Admin approved.
   */
  WHEN admin_review.decision = 'APPROVED'
    THEN 'APPROVED_BY_ADMIN'

  /*
   * Lead approved but higher levels have not.
   */
  WHEN lead_review.decision = 'APPROVED'
    THEN 'APPROVED_BY_TEAM_LEAD'

  /*
   * Rejection propagates upward.
   */
  WHEN lead_review.decision = 'REJECTED'
    THEN 'REJECTED_BY_TEAM_LEAD'

  WHEN admin_review.decision = 'REJECTED'
    THEN 'REJECTED_BY_ADMIN'

  WHEN super_review.decision = 'REJECTED'
    THEN 'REJECTED_BY_SUPER_ADMIN'

  /*
   * Changes requested.
   */
  WHEN super_review.decision = 'NEEDS_CHANGES'
    THEN 'CHANGES_REQUESTED_BY_SUPER_ADMIN'

  WHEN admin_review.decision = 'NEEDS_CHANGES'
    THEN 'CHANGES_REQUESTED_BY_ADMIN'

  WHEN lead_review.decision = 'NEEDS_CHANGES'
    THEN 'CHANGES_REQUESTED_BY_TEAM_LEAD'

  ELSE 'AWAITING_REVIEW'

END AS hierarchy_review_status,

    /*
     * =====================================================
     * NEXT PENDING REVIEWER
     * =====================================================
     */

    CASE
      WHEN t.status IN ('DRAFT', 'REJECTED', 'NEEDS_CHANGES', 'COMPLETED', 'CANCELLED') THEN NULL
      WHEN lead_review.decision = 'PENDING'
       AND admin_review.decision = 'PENDING'
       AND super_review.decision = 'PENDING'
      THEN 'TEAM_LEAD'
      WHEN lead_review.decision = 'APPROVED'
       AND admin_review.decision = 'PENDING'
       AND super_review.decision = 'PENDING'
      THEN 'ADMIN'
      WHEN lead_review.decision = 'APPROVED'
       AND admin_review.decision = 'APPROVED'
       AND super_review.decision = 'PENDING'
      THEN 'SUPER_ADMIN'
      ELSE NULL
    END AS next_reviewer_role,

    /*
     * =====================================================
     * DISPLAY STATUS
     * =====================================================
     */

 /*
 * =====================================================
 * DISPLAY STATUS
 * =====================================================
 *
 * Review rejection is displayed as REJECTED even though
 * the internal task.status remains SUBMITTED so the
 * next hierarchy level can override it.
 */

CASE
     WHEN t.status = 'REJECTED' THEN 'REJECTED'
     WHEN t.status = 'NEEDS_CHANGES' THEN 'NEEDS_CHANGES'
     WHEN t.due_date < now() AND t.status NOT IN ('COMPLETED', 'CANCELLED', 'DRAFT') THEN 'OVERDUE'
     ELSE t.status
   END AS display_status

  FROM tasks t

  JOIN employees e
    ON e.id = t.assigned_to

  LEFT JOIN departments d
    ON d.id = e.department_id

  LEFT JOIN employees tl
    ON tl.id = e.team_lead_id

  LEFT JOIN employees c
    ON c.id = t.created_by

  LEFT JOIN LATERAL (
    SELECT teh.id, teh.edited_at,
           COALESCE(editor.first_name || ' ' || editor.last_name, 'System') AS editor_name
    FROM task_edit_history teh
    LEFT JOIN employees editor ON editor.id = teh.edited_by
    WHERE teh.task_id = t.id
    ORDER BY teh.edited_at DESC, teh.id DESC
    LIMIT 1
  ) latest_edit ON true

  /*
   * =====================================================
   * LATEST SUBMISSION
   * =====================================================
   */

  LEFT JOIN LATERAL (
    SELECT *
    FROM task_completion_submissions
    WHERE task_id = t.id
    ORDER BY
      submitted_at DESC,
      id DESC
    LIMIT 1
  ) cs ON true

  /*
   * =====================================================
   * TEAM LEAD REVIEW
   * =====================================================
   */

  LEFT JOIN task_reviews lead_review
    ON lead_review.submission_id = cs.id
   AND lead_review.reviewer_role = 'TEAM_LEAD'

  LEFT JOIN employees lead_reviewer
    ON lead_reviewer.id =
       lead_review.reviewer_id

  /*
   * =====================================================
   * ADMIN REVIEW
   * =====================================================
   */

  LEFT JOIN task_reviews admin_review
    ON admin_review.submission_id = cs.id
   AND admin_review.reviewer_role = 'ADMIN'

  LEFT JOIN employees admin_reviewer
    ON admin_reviewer.id =
       admin_review.reviewer_id

  /*
   * =====================================================
   * SUPER ADMIN REVIEW
   * =====================================================
   */

  LEFT JOIN task_reviews super_review
    ON super_review.submission_id = cs.id
   AND super_review.reviewer_role = 'SUPER_ADMIN'

  LEFT JOIN employees super_reviewer
    ON super_reviewer.id =
       super_review.reviewer_id

  ${w}

  ${(statusGroup === 'completed' || statusGroup === 'past' || status === 'COMPLETED')
    ? 'ORDER BY COALESCE(t.completed_at, t.updated_at, t.created_at) DESC, t.id DESC'
    : (statusGroup === 'rejected' || status === 'REJECTED')
    ? 'ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.id DESC'
    : 'ORDER BY GREATEST(t.created_at, COALESCE(latest_edit.edited_at, t.created_at)) DESC, t.id DESC'}
  `,

  [
    ...p,
    req.user!.role,
    req.user!.employeeId
  ]
);

res.json(r.rows);
}
export async function createTask(req: Request, res: Response) {
  const {
    title,
    description,
    assignmentType = 'INDIVIDUAL',
    assignedTo = req.body.assigned_to,
    assignedToIds = req.body.assigned_to_ids,
    teamLeadId = req.body.team_lead_id,
    departmentId = req.body.department_id,
    priority = 'MEDIUM',
    startDate = req.body.start_date,
    dueDate = req.body.due_date,
    attachmentUrl = req.body.attachment_url,
    taskType = req.body.task_type || 'TECHNICAL',
    saveAsDraft = false
  } = req.body;
  const draft = String(saveAsDraft).toLowerCase() === 'true' || saveAsDraft === true;
if (!draft && (!title || !String(title).trim())) {
  return res.status(400).json({
    message: 'Task title is required.'
  });
}

if (title && String(title).trim().length > 500) {
  return res.status(400).json({
    message: 'Task title must be 500 characters or less. Put additional details in the description.'
  });
}  const type = String(assignmentType).toUpperCase();
  const normalizedTaskType = String(taskType || 'TECHNICAL').toUpperCase();
  if (!['TECHNICAL', 'NON_TECHNICAL'].includes(normalizedTaskType)) return res.status(400).json({ message: 'Invalid task type.' });
  if (!draft && !['INDIVIDUAL', 'MULTIPLE', 'TEAM', 'DEPARTMENT', 'ADMIN'].includes(type)) return res.status(400).json({ message: 'Invalid assignment type.' });
  let ids: number[] = [];
  let scopeRef: number | null = null;

  // Drafts belong to the creator and are not assigned/notified until published.
  if (draft) {
    ids = [req.user!.employeeId!];
  }
  if (!draft && type === 'INDIVIDUAL') ids = [Number(assignedTo)].filter(Boolean);
  if (!draft && type === 'MULTIPLE') ids = (Array.isArray(assignedToIds) ? assignedToIds : String(assignedToIds || '').split(',')).map(Number).filter(Boolean);
  if (!draft && type === 'ADMIN') {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user!.role)) {
      return res.status(403).json({ message: 'Only Admins and Super Admin can create Admin-assigned tasks.' });
    }

    const adminId = Number(assignedTo);
    if (!adminId) {
      return res.status(400).json({ message: 'Select an Admin.' });
    }

    const rr = await query<any>(`
      SELECT e.id
      FROM employees e
      JOIN users u ON u.employee_id=e.id
      WHERE e.id=$1
        AND u.role='ADMIN'
        AND u.is_active=true
        AND e.status='ACTIVE'
      LIMIT 1
    `, [adminId]);

    if (!rr.rows[0]) {
      return res.status(400).json({ message: 'Selected Admin is not a valid active Admin account.' });
    }

    ids = [adminId];
  }
  if (!draft && type === 'TEAM') {
    scopeRef = req.user!.role === 'TEAM_LEAD' ? req.user!.employeeId : Number(teamLeadId);
    if (!scopeRef) return res.status(400).json({ message: 'Select a team lead/team.' });
    const rr = await query<any>('SELECT id FROM employees WHERE team_lead_id=$1 AND status=\'ACTIVE\'', [scopeRef]); ids = rr.rows.map(x => x.id);
  }
  if (!draft && type === 'DEPARTMENT') {
    if (req.user!.role === 'TEAM_LEAD') return res.status(403).json({ message: 'Team Leads can assign only to their own team, not an entire department.' });
    scopeRef = Number(departmentId);
    if (!scopeRef) return res.status(400).json({ message: 'Select a department.' });
    const rr = await query<any>('SELECT id FROM employees WHERE department_id=$1 AND status=\'ACTIVE\'', [scopeRef]); ids = rr.rows.map(x => x.id);
  }
  ids = [...new Set(ids)];
  if (!draft && !ids.length) return res.status(400).json({ message: 'No eligible employee/intern was selected for this task.' });
  if (!draft && req.user!.role === 'TEAM_LEAD') {
    for (const id of ids) if (!(await isTeamMember(req.user!.employeeId, id))) return res.status(403).json({ message: 'Team Leads may assign tasks only to employees/interns under their supervision.' });
  }
  const batchId = randomUUID();
  const client = await pool.connect();
  const created: any[] = [];
  try {
    await client.query('BEGIN');
    for (const id of ids) {
      const r = await client.query<any>(`INSERT INTO tasks(assignment_batch_id,assignment_scope,scope_ref_id,title,description,assigned_to,created_by,priority,start_date,due_date,attachment_url,task_type,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [batchId, draft ? 'INDIVIDUAL' : type, draft ? null : scopeRef, draft ? (title && String(title).trim() ? String(title).trim() : 'Untitled Draft') : title, textOrNull(description), id, req.user!.employeeId, priority, startDate || null, dueDate || null, textOrNull(attachmentUrl), normalizedTaskType, draft ? 'DRAFT' : 'PENDING']);
      created.push(r.rows[0]);
      if (!draft) {
        await client.query(`INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id) VALUES($1,'TASK_ASSIGNED','New task assigned',$2,'TASK',$3)`, [id, title, String(r.rows[0].id)]);
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await audit(req.user?.userId, draft ? 'CREATE_DRAFT' : 'CREATE', 'TASK', batchId, { title: created[0]?.title, assignmentType: draft ? 'DRAFT' : type, assignedCount: draft ? 0 : ids.length, assignedTo: draft ? [] : ids });
  res.status(201).json({ batchId, assignedCount: draft ? 0 : ids.length, tasks: created });
}



export async function updateTask(req: Request, res: Response) {
  const id = Number(req.params.id);

  const t = await query<any>(
    'SELECT * FROM tasks WHERE id=$1',
    [id]
  );

  if (!t.rows[0]) {
    return res.status(404).json({
      message: 'Task not found'
    });
  }

  const task = t.rows[0];

  // Only the assigned employee can update their task.
  if (task.assigned_to !== req.user!.employeeId) {
    return res.status(403).json({
      message: 'Only the assigned user can update this task.'
    });
  }

  const b = req.body;

  const requestedStatus = b.status
    ? String(b.status).toUpperCase()
    : null;

  /*
   * Employees cannot directly set review/final statuses:
   *
   * COMPLETED
   * SUBMITTED
   * REJECTED
   * CANCELLED
   * NEEDS_CHANGES
   *
   * They may edit task fields and return a NEEDS_CHANGES
   * task to IN_PROGRESS for another work cycle.
   *
   * SUBMITTED is handled by /tasks/:id/submit.
   * COMPLETED / NEEDS_CHANGES / REJECTED are handled
   * by /tasks/:id/review.
   */
  const employeeStatuses = [
    'PENDING',
    'IN_PROGRESS',
    'BLOCKED'
  ];

  if (
    requestedStatus &&
    !employeeStatuses.includes(requestedStatus)
  ) {
    return res.status(403).json({
      message:
        'This status cannot be changed directly. Complete the task and submit it for review.'
    });
  }

  // Validate progress.
  let progress: number | null = null;

  if (b.progress !== undefined) {
    progress = Number(b.progress);

    if (
      !Number.isFinite(progress) ||
      progress < 0 ||
      progress > 100
    ) {
      return res.status(400).json({
        message: 'Progress must be between 0 and 100.'
      });
    }
  }

  // If employee selects IN_PROGRESS but sends no progress,
  // preserve current progress.
  if (
    requestedStatus === 'IN_PROGRESS' &&
    progress === null
  ) {
    progress = task.progress;
  }

  /*
   * Employee cannot submit 100% as COMPLETED.
   * 100% only represents the employee's completion claim.
   */
  if (progress === 100 && requestedStatus !== 'IN_PROGRESS') {
    return res.status(400).json({
      message:
        'To complete this task, use Submit for Review.'
    });
  }

  const newStatus = requestedStatus || task.status;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const r = await client.query<any>(
      `
      UPDATE tasks
      SET
        title=COALESCE($1, title),
        description=COALESCE($2, description),
        status=$3,
        progress=COALESCE($4, progress),
        attachment_url=COALESCE($5, attachment_url),
        updated_at=now()
      WHERE id=$6
      RETURNING *
      `,
      [
        b.title !== undefined ? textOrNull(b.title) : null,
        b.description !== undefined ? textOrNull(b.description) : null,
        newStatus,
        progress,
        b.attachmentUrl !== undefined ? textOrNull(b.attachmentUrl) : null,
        id
      ]
    );

    /*
     * Record status change.
     */
    if (newStatus !== task.status) {
      await client.query(
        `
        INSERT INTO task_status_history
        (
          task_id,
          old_status,
          new_status,
          changed_by
        )
        VALUES($1,$2,$3,$4)
        `,
        [
          id,
          task.status,
          newStatus,
          req.user!.employeeId
        ]
      );
    }

    const editChanges = buildTaskEditChanges(task, r.rows[0]);
    if (Object.keys(editChanges).length) {
      await client.query(
        `INSERT INTO task_edit_history(task_id,edited_by,changes) VALUES($1,$2,$3::jsonb)`,
        [id, req.user!.employeeId, JSON.stringify(editChanges)]
      );
    }

    await client.query('COMMIT');

    /*
     * Notify task creator.
     */
    if (
      task.created_by &&
      task.created_by !== req.user!.employeeId
    ) {
      await query(
        `
        INSERT INTO notifications
        (
          employee_id,
          type,
          title,
          message,
          entity_type,
          entity_id
        )
        VALUES
        (
          $1,
          'TASK_UPDATED',
          'Task updated',
          $2,
          'TASK',
          $3
        )
        `,
        [
          task.created_by,
          `${task.title}: ${newStatus}`,
          String(id)
        ]
      );
    }

    await audit(
      req.user?.userId,
      'UPDATE_PROGRESS',
      'TASK',
      id,
      {
        oldStatus: task.status,
        newStatus,
        progress
      }
    );

    res.json(r.rows[0]);

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function submitTaskForReview(
  req: Request,
  res: Response
) {
  const id = Number(req.params.id);

  const {
    completionSummary,
    proofType,
    proofUrl,
    proofFileName,
    proofFileData
  } = req.body;

  if (!completionSummary?.trim()) {
    return res.status(400).json({
      message: 'Completion summary is required.'
    });
  }

  const hasProofUrl = !!proofUrl?.trim();
  const hasProofFile = !!proofFileName && !!proofFileData;

  const taskResult = await query<any>(
    'SELECT * FROM tasks WHERE id=$1',
    [id]
  );

  if (!taskResult.rows[0]) {
    return res.status(404).json({
      message: 'Task not found.'
    });
  }

  const task = taskResult.rows[0];

  /*
   * Only assigned employee can submit.
   */
  if (
    task.assigned_to !==
    req.user!.employeeId
  ) {
    return res.status(403).json({
      message:
        'Only the assigned employee can submit this task for review.'
    });
  }

  /*
   * Task must be ready for submission.
   */
  if (
    ![
      'IN_PROGRESS',
      'NEEDS_CHANGES'
    ].includes(task.status)
  ) {
    return res.status(400).json({
      message:
        `Task cannot be submitted from ${task.status} status.`
    });
  }

  /*
   * Task must be 100% complete.
   */
  if (Number(task.progress) < 100) {
    return res.status(400).json({
      message:
        'Set task progress to 100% before submitting it for review.'
    });
  }

  /* Validate proof link if provided (optional, any valid URL accepted) */
  let normalizedProofType = String(proofType || (hasProofFile ? 'FILE' : (hasProofUrl ? 'LINK' : 'NONE'))).toUpperCase();
  if (hasProofUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(proofUrl.trim());
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return res.status(400).json({ message: 'Proof link must start with http:// or https://' });
      }
    } catch {
      return res.status(400).json({ message: 'Proof link must be a valid URL.' });
    }
    normalizedProofType = 'LINK';
  } else if (hasProofFile) {
    normalizedProofType = 'FILE';
  } else {
    normalizedProofType = 'NONE';
  }

  let savedProofName: string | null = null;
  let savedProofPath: string | null = null;
  if (hasProofFile) {
    const match = String(proofFileData).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ message: 'Uploaded proof file is invalid.' });
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 5 * 1024 * 1024) return res.status(400).json({ message: 'Proof file must be 5 MB or smaller.' });
    const safeOriginal = path.basename(String(proofFileName)).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storedName = `${Date.now()}-${randomUUID()}-${safeOriginal}`;
    const uploadDir = path.resolve(process.cwd(), 'uploads', 'task-proofs');
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, storedName), bytes);
    savedProofName = safeOriginal;
    savedProofPath = `/uploads/task-proofs/${storedName}`;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    /*
     * =========================================================
     * 1. CREATE COMPLETION SUBMISSION
     * =========================================================
     */

    const submission =
      await client.query<any>(
        `
        INSERT INTO task_completion_submissions
        (
          task_id,
          submitted_by,
          completion_summary,
          proof_type,
          proof_url,
          proof_file_name,
          proof_file_path
        )
        VALUES
        ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [
          id,
          req.user!.employeeId,
          completionSummary.trim(),
          normalizedProofType,
          hasProofUrl ? proofUrl.trim() : null,
          savedProofName,
          savedProofPath
        ]
      );

    const submissionId =
      submission.rows[0].id;

    /*
     * =========================================================
     * 2. CHANGE TASK STATUS
     *
     * IN_PROGRESS / NEEDS_CHANGES
     *             ↓
     *          SUBMITTED
     * =========================================================
     */

    await client.query(
      `
      UPDATE tasks
      SET
        status = 'SUBMITTED',
        progress = 100,
        updated_at = now()
      WHERE id = $1
      `,
      [id]
    );

    /*
     * =========================================================
     * 3. STATUS HISTORY
     * =========================================================
     */

    await client.query(
      `
      INSERT INTO task_status_history
      (
        task_id,
        old_status,
        new_status,
        changed_by,
        reason
      )
      VALUES
      (
        $1,
        $2,
        'SUBMITTED',
        $3,
        $4
      )
      `,
      [
        id,
        task.status,
        req.user!.employeeId,
        'Task submitted for completion review.'
      ]
    );

    /*
     * =========================================================
     * 4. FIND TEAM LEAD
     * =========================================================
     *
     * The employee's direct team lead is used for the
     * TEAM_LEAD review stage.
     */

    const employeeResult =
      await client.query<any>(
        `
        SELECT
          id,
          team_lead_id
        FROM employees
        WHERE id = $1
        `,
        [task.assigned_to]
      );

    const teamLeadId =
      employeeResult.rows[0]?.team_lead_id || null;

    /*
     * =========================================================
     * 5. CREATE THREE REVIEW STAGES
     *
     * Every submission gets:
     *
     * TEAM_LEAD      → PENDING
     * ADMIN          → PENDING
     * SUPER_ADMIN    → PENDING
     *
     * We don't assign reviewer_id yet for ADMIN and
     * SUPER_ADMIN because any eligible reviewer at that
     * hierarchy level can perform the review.
     * =========================================================
     */

    await client.query(
      `
      INSERT INTO task_reviews
      (
        task_id,
        submission_id,
        reviewer_id,
        reviewer_role,
        decision
      )
      VALUES
      (
        $1,
        $2,
        $3,
        'TEAM_LEAD',
        'PENDING'
      )
      ON CONFLICT
      (
        submission_id,
        reviewer_role
      )
      DO NOTHING
      `,
      [
        id,
        submissionId,
        teamLeadId
      ]
    );

    await client.query(
      `
      INSERT INTO task_reviews
      (
        task_id,
        submission_id,
        reviewer_id,
        reviewer_role,
        decision
      )
      VALUES
      (
        $1,
        $2,
        NULL,
        'ADMIN',
        'PENDING'
      )
      ON CONFLICT
      (
        submission_id,
        reviewer_role
      )
      DO NOTHING
      `,
      [
        id,
        submissionId
      ]
    );

    await client.query(
      `
      INSERT INTO task_reviews
      (
        task_id,
        submission_id,
        reviewer_id,
        reviewer_role,
        decision
      )
      VALUES
      (
        $1,
        $2,
        NULL,
        'SUPER_ADMIN',
        'PENDING'
      )
      ON CONFLICT
      (
        submission_id,
        reviewer_role
      )
      DO NOTHING
      `,
      [
        id,
        submissionId
      ]
    );

    /*
     * =========================================================
     * 6. NOTIFY TEAM LEAD
     * =========================================================
     */

    if (
      teamLeadId &&
      teamLeadId !==
        req.user!.employeeId
    ) {
      await client.query(
        `
        INSERT INTO notifications
        (
          employee_id,
          type,
          title,
          message,
          entity_type,
          entity_id
        )
        VALUES
        (
          $1,
          'TASK_REVIEW',
          'Task awaiting review',
          $2,
          'TASK',
          $3
        )
        `,
        [
          teamLeadId,
          `${task.title} has been submitted for review.`,
          String(id)
        ]
      );
    }
/*
 * =========================================================
 * 7. NOTIFY ALL ADMINS
 *
 * IMPORTANT:
 * Role is stored in users.role.
 * Employee identity is stored in users.employee_id.
 * =========================================================
 */

const admins = await client.query<any>(
  `
  SELECT
    u.employee_id
  FROM users u
  WHERE u.role = 'ADMIN'
    AND u.is_active = true
    AND u.employee_id IS NOT NULL
  `
);

for (const admin of admins.rows) {
  await client.query(
    `
    INSERT INTO notifications
    (
      employee_id,
      type,
      title,
      message,
      entity_type,
      entity_id
    )
    VALUES
    (
      $1,
      'TASK_REVIEW',
      'Task submitted for review',
      $2,
      'TASK',
      $3
    )
    `,
    [
      admin.employee_id,
      `${task.title} has been submitted and is awaiting management review.`,
      String(id)
    ]
  );
}


/*
 * =========================================================
 * 8. NOTIFY ALL SUPER ADMINS
 *
 * Role is stored in users.role.
 * =========================================================
 */

const superAdmins = await client.query<any>(
  `
  SELECT
    u.employee_id
  FROM users u
  WHERE u.role = 'SUPER_ADMIN'
    AND u.is_active = true
    AND u.employee_id IS NOT NULL
  `
);

for (const superAdmin of superAdmins.rows) {
  await client.query(
    `
    INSERT INTO notifications
    (
      employee_id,
      type,
      title,
      message,
      entity_type,
      entity_id
    )
    VALUES
    (
      $1,
      'TASK_REVIEW',
      'Task submitted for review',
      $2,
      'TASK',
      $3
    )
    `,
    [
      superAdmin.employee_id,
      `${task.title} has been submitted and is awaiting management review.`,
      String(id)
    ]
  );
}
    /*
     * =========================================================
     * 9. COMMIT
     * =========================================================
     */

    await client.query('COMMIT');

    /*
     * =========================================================
     * 10. AUDIT LOG
     * =========================================================
     */

    await audit(
      req.user?.userId,
      'SUBMIT_FOR_REVIEW',
      'TASK',
      id,
      {
        submissionId,
        proofType:
          normalizedProofType,
        proofUrl:
          hasProofUrl ? proofUrl.trim() : null
      }
    );

    return res.status(201).json({
      message:
        'Task submitted for review.',
      submission:
        submission.rows[0]
    });

  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function reviewTask(
  req: Request,
  res: Response
) {
  const id = Number(req.params.id);

  const {
    decision,
    comment
  } = req.body;

  const normalizedDecision =
    String(decision || '').toUpperCase();
  const databaseDecision =
  normalizedDecision === 'APPROVE'
    ? 'APPROVED'
    : normalizedDecision === 'REJECT'
    ? 'REJECTED'
    : normalizedDecision;

  /*
   * =====================================================
   * VALIDATE DECISION
   * =====================================================
   */

  if (
    ![
      'APPROVE',
      'NEEDS_CHANGES',
      'REJECT'
    ].includes(normalizedDecision)
  ) {
    return res.status(400).json({
      message:
        'Invalid review decision. Use APPROVE, NEEDS_CHANGES or REJECT.'
    });
  }

  /*
   * NEEDS_CHANGES and REJECT require feedback.
   */

  if (
    ['NEEDS_CHANGES', 'REJECT'].includes(
      normalizedDecision
    ) &&
    !comment?.trim()
  ) {
    return res.status(400).json({
      message:
        'A review comment is required for this decision.'
    });
  }

  /*
   * =====================================================
   * GET TASK
   * =====================================================
   */

  const taskResult = await query<any>(
    `
    SELECT
      t.*,
      e.team_lead_id
    FROM tasks t
    JOIN employees e
      ON e.id = t.assigned_to
    WHERE t.id = $1::integer
    `,
    [id]
  );

  if (!taskResult.rows[0]) {
    return res.status(404).json({
      message: 'Task not found.'
    });
  }

  const task = taskResult.rows[0];

  /*
   * =====================================================
   * GET LATEST SUBMISSION
   * =====================================================
   */

  let submissionResult = await query<any>(
    `
    SELECT *
    FROM task_completion_submissions
    WHERE task_id = $1::integer
    ORDER BY
      submitted_at DESC,
      id DESC
    LIMIT 1
    `,
    [id]
  );

  let submission = submissionResult.rows[0];

  if (!submission) {
    if (task.status === 'COMPLETED' || task.status === 'SUBMITTED' || Number(task.progress) >= 100) {
      const createdSub = await query<any>(
        `INSERT INTO task_completion_submissions(task_id, submitted_by, completion_summary, proof_type, submitted_at)
         VALUES($1, $2, $3, 'NONE', now())
         RETURNING *`,
        [id, task.assigned_to, 'Task marked 100% progress / direct review']
      );
      submission = createdSub.rows[0];
      const teamLeadId = task.team_lead_id || null;
      await query(
        `INSERT INTO task_reviews(task_id, submission_id, reviewer_id, reviewer_role, decision)
         VALUES
           ($1, $2, $3, 'TEAM_LEAD', 'PENDING'),
           ($1, $2, NULL, 'ADMIN', 'PENDING'),
           ($1, $2, NULL, 'SUPER_ADMIN', 'PENDING')
         ON CONFLICT (submission_id, reviewer_role) DO NOTHING`,
        [id, submission.id, teamLeadId]
      );
    } else {
      return res.status(400).json({
        message: 'No completion submission exists for this task and task progress is not 100%.'
      });
    }
  }

  /*
   * =====================================================
   * REVIEWER INFORMATION
   * =====================================================
   */

  const role = req.user!.role;

  const reviewerEmployeeId =
    req.user!.employeeId;

  /*
   * Only these three roles can review.
   */

  if (
    ![
      'TEAM_LEAD',
      'ADMIN',
      'SUPER_ADMIN'
    ].includes(role)
  ) {
    return res.status(403).json({
      message:
        'You do not have permission to review tasks.'
    });
  }

  /*
   * =====================================================
   * TEAM LEAD AUTHORIZATION
   * =====================================================
   *
   * Team Lead can only review employees/interns
   * directly under that Team Lead.
   *
   * This does NOT affect Admin or Super Admin.
   */

  if (role === 'TEAM_LEAD') {

    /*
     * Cannot review own task.
     */

    if (
      task.assigned_to ===
      reviewerEmployeeId
    ) {
      return res.status(403).json({
        message:
          'Team Leads cannot review their own tasks.'
      });
    }

    /*
     * Must be the employee's actual Team Lead.
     */

    if (
      task.team_lead_id !==
      reviewerEmployeeId
    ) {
      return res.status(403).json({
        message:
          'You can review only tasks assigned to employees/interns under your supervision.'
      });
    }
  }

  /*
   * =====================================================
   * ADMIN AUTHORIZATION
   * =====================================================
   *
   * Admins may review only tasks assigned to themselves
   * or to Team Leads / team members connected to them.
   */

  if (role === 'ADMIN') {
    const hasAccess = await isEmployeeInAdminHierarchy(
      reviewerEmployeeId,
      task.assigned_to
    );

    if (!hasAccess) {
      return res.status(403).json({
        message:
          'You can review only your own tasks and tasks belonging to teams under your Admin account.'
      });
    }
  }

  /*
   * =====================================================
   * GET THIS REVIEWER'S REVIEW RECORD
   * =====================================================
   *
   * IMPORTANT:
   *
   * We check the review belonging to the CURRENT
   * reviewer role.
   *
   * We do NOT check the previous review's decision
   * to decide whether this reviewer can act.
   *
   * This is what allows:
   *
   * TEAM LEAD REJECTED
   *        ↓
   * ADMIN CAN OVERRIDE
   *
   * ADMIN REJECTED
   *        ↓
   * SUPER ADMIN CAN OVERRIDE
   */

  const currentReviewResult =
    await query<any>(
      `
      SELECT *
      FROM task_reviews
      WHERE
        submission_id = $1::integer
        AND reviewer_role = $2::varchar
      ORDER BY id DESC
      LIMIT 1
      `,
      [
        submission.id,
        role
      ]
    );

  if (!currentReviewResult.rows[0]) {
    return res.status(403).json({
      message:
        'No review assignment exists for your role for this submission.'
    });
  }

  const currentReview =
    currentReviewResult.rows[0];

  /*
   * =====================================================
   * CURRENT REVIEWER MUST STILL BE PENDING
   * =====================================================
   *
   * This prevents:
   *
   * Admin approving twice
   * Team Lead approving after already approving
   * Super Admin changing its final decision
   */

  if (
    currentReview.decision !==
    'PENDING'
  ) {
    return res.status(400).json({
      message:
        `Your review has already been ${String(
          currentReview.decision
        ).toLowerCase()}.`
    });
  }

  /*
   * =====================================================
   * REVIEW ORDER / TASK STATE
   * =====================================================
   * Strict hierarchy: TEAM_LEAD -> ADMIN -> SUPER_ADMIN.
   * REJECT is final. NEEDS_CHANGES returns the task to employee.
   */

   if (task.status !== 'SUBMITTED' && task.status !== 'COMPLETED' && Number(task.progress) < 100) {
     return res.status(400).json({
       message: `This task cannot currently be reviewed. Current status: ${task.status}. Task progress must be 100% or task submitted.`
     });
   }


   /*
    * =====================================================
    * COMMENT
    * =====================================================
    */

  const reviewerComment =
    comment?.trim() || null;

  /*
   * =====================================================
   * CONNECT TO DATABASE
   * =====================================================
   */

  const client =
    await pool.connect();

  try {
    await client.query('BEGIN');

    /*
     * =====================================================
     * 1. UPDATE CURRENT REVIEW
     * =====================================================
     *
     * Only THIS reviewer's row is changed.
     *
     * Example:
     *
     * Lead rejects:
     *
     * LEAD  → REJECTED
     * ADMIN → PENDING
     * SUPER → PENDING
     *
     * Admin then approves:
     *
     * LEAD  → REJECTED
     * ADMIN → APPROVED
     * SUPER → PENDING
     *
     * Super Admin then approves:
     *
     * LEAD  → REJECTED
     * ADMIN → APPROVED
     * SUPER → APPROVED
     */

    await client.query(
      `
      UPDATE task_reviews
      SET
        decision = $1::varchar,
        comment = $2::text,
        reviewer_id = $3::integer,
        reviewed_at = now()
      WHERE
        id = $4::integer
      `,
      [
        databaseDecision,
        reviewerComment,
        reviewerEmployeeId,
        currentReview.id
      ]
    );


    /*
 * =====================================================
 * SKIP LOWER HIERARCHY ON HIGHER APPROVAL
 * =====================================================
 *
 * ADMIN approval:
 *   - Skip pending Team Lead review
 *
 * SUPER ADMIN approval:
 *   - Skip pending Team Lead review
 *   - Skip pending Admin review
 *
 * Already completed reviews are NOT changed.
 */

if (normalizedDecision === 'APPROVE') {

  if (role === 'ADMIN') {
    await client.query(
      `
      UPDATE task_reviews
      SET
        decision = 'SKIPPED',
        reviewed_at = now()
      WHERE submission_id = $1::integer
        AND reviewer_role = 'TEAM_LEAD'
        AND decision = 'PENDING'
      `,
      [submission.id]
    );
  }

  if (role === 'SUPER_ADMIN') {
    await client.query(
      `
      UPDATE task_reviews
      SET
        decision = 'SKIPPED',
        reviewed_at = now()
      WHERE submission_id = $1::integer
        AND reviewer_role IN ('TEAM_LEAD', 'ADMIN')
        AND decision = 'PENDING'
      `,
      [submission.id]
    );
  }
}

  /*
  * =====================================================
  * CLOSE REVIEW CHAIN ON REJECTION
  * =====================================================
  * A rejection is final. Pending higher reviews are skipped.
  */

  if (
    normalizedDecision === 'REJECT' ||
    normalizedDecision === 'NEEDS_CHANGES'
  ) {
    await client.query(
      `
      UPDATE task_reviews
      SET decision = 'SKIPPED', reviewed_at = now()
      WHERE submission_id = $1::integer
        AND id <> $2::integer
        AND decision = 'PENDING'
      `,
      [submission.id, currentReview.id]
    );
  }

/*
 * =====================================================
 * 2. DETERMINE TASK STATUS
 * =====================================================
 * APPROVE: TEAM_LEAD / ADMIN -> SUBMITTED; SUPER_ADMIN -> COMPLETED
 * NEEDS_CHANGES: ANY LEVEL -> NEEDS_CHANGES
 * REJECT: ANY LEVEL -> REJECTED (FINAL)
 */

let newStatus = task.status;
let progress = Number(task.progress || 100);
let completedAt = task.completed_at;

if (normalizedDecision === 'REJECT') {
  newStatus = 'REJECTED';
  progress = 100;
  completedAt = null;
}
else if (normalizedDecision === 'NEEDS_CHANGES') {
  newStatus = 'NEEDS_CHANGES';
  progress = 100;
  completedAt = null;
}
else if (role === 'SUPER_ADMIN') {
  newStatus = 'COMPLETED';
  progress = 100;
  completedAt = task.completed_at || new Date();
}
else {
  newStatus = 'SUBMITTED';
  progress = 100;
  completedAt = null;
}
/*
     * =====================================================
     * 3. UPDATE TASK
     * =====================================================
     */

    await client.query(
      `
      UPDATE tasks
      SET
        status = $1::varchar,
        progress = $2::integer,
        completed_at = $3,
        updated_at = now()
      WHERE id = $4::integer
      `,
      [
        newStatus,
        progress,
        completedAt,
        id
      ]
    );

    /*
     * =====================================================
     * 4. STATUS HISTORY
     * =====================================================
     */

    await client.query(
      `
      INSERT INTO task_status_history
      (
        task_id,
        old_status,
        new_status,
        changed_by,
        reason
      )
      VALUES
      (
        $1::integer,
        $2::varchar,
        $3::varchar,
        $4::integer,
        $5::text
      )
      `,
      [
        id,
        task.status,
        newStatus,
        reviewerEmployeeId,
        reviewerComment ||
          `Reviewed by ${role}. Decision: ${normalizedDecision}`
      ]
    );

    /*
     * =====================================================
     * 5. GET REVIEWER NAME
     * =====================================================
     */

    const reviewerResult =
      await client.query<any>(
        `
        SELECT
          first_name || ' ' || last_name
          AS reviewer_name
        FROM employees
        WHERE id = $1::integer
        `,
        [reviewerEmployeeId]
      );

    const reviewerName =
      reviewerResult.rows[0]
        ?.reviewer_name ||
      role;

    /*
     * =====================================================
     * 6. NOTIFY EMPLOYEE
     * =====================================================
     */

    let notificationTitle =
      '';

    let notificationMessage =
      '';

    if (
      normalizedDecision ===
      'APPROVE'
    ) {

      notificationTitle =
        role === 'SUPER_ADMIN'
          ? 'Task completed'
          : 'Task approved';

      notificationMessage =
        role === 'SUPER_ADMIN'
          ? `${task.title} has been finally approved by Super Admin and marked as completed.`
          : `${task.title} has been approved by ${reviewerName}. It is now awaiting the next level of approval.`;
    }

    else if (
      normalizedDecision ===
      'NEEDS_CHANGES'
    ) {

      notificationTitle =
        'Changes requested';

      notificationMessage =
        `${task.title} requires changes. Feedback from ${reviewerName}: ${reviewerComment}`;
    }

    else if (
      normalizedDecision ===
      'REJECT'
    ) {

      notificationTitle =
        'Task rejected';

             notificationMessage =
         `${task.title} has been rejected by ${reviewerName}.`;

       if (reviewerComment) {
         notificationMessage += ` Reason: ${reviewerComment}`;
       }
     }

     /*
      * Send notification to employee.
     */

    await client.query(
      `
      INSERT INTO notifications
      (
        employee_id,
        type,
        title,
        message,
        entity_type,
        entity_id
      )
      VALUES
      (
        $1::integer,
        $2::varchar,
        $3::varchar,
        $4::text,
        $5::varchar,
        $6::integer
      )
      `,
      [
        task.assigned_to,
        'TASK_REVIEW',
        notificationTitle,
        notificationMessage,
        'TASK',
        id
      ]
    );

    /*
     * =====================================================
     * 7. NOTIFY NEXT HIGHER REVIEWER
     * =====================================================
     */

    let nextRole:
      | 'ADMIN'
      | 'SUPER_ADMIN'
      | null = null;

    if (role === 'TEAM_LEAD') {
      nextRole = 'ADMIN';
    }

    else if (role === 'ADMIN') {
      nextRole = 'SUPER_ADMIN';
    }

    /*
     * Super Admin is the final level.
     */

    if (nextRole && normalizedDecision === 'APPROVE') {

      /*
       * Find an active user with the next role.
       *
       * reviewer_id is the employee ID stored
       * in employees, while users.role determines
       * the account role.
       */

      const nextReviewer =
        await client.query<any>(
          `
          SELECT
            u.employee_id
          FROM users u
          WHERE
            u.role = $1::varchar
            AND u.is_active = true
            AND u.employee_id IS NOT NULL
          ORDER BY u.id
          LIMIT 1
          `,
          [nextRole]
        );

      if (
        nextReviewer.rows[0]
          ?.employee_id
      ) {

        const nextReviewerId =
          nextReviewer.rows[0]
            .employee_id;

        /*
         * Don't notify the employee itself
         * as a reviewer.
         */

        if (
          nextReviewerId !==
          task.assigned_to
        ) {

          let nextTitle =
            'Task awaiting review';

          let nextMessage =
            `${task.title} is awaiting ${nextRole === 'ADMIN' ? 'Admin' : 'Super Admin'} review.`;

          await client.query(
            `
            INSERT INTO notifications
            (
              employee_id,
              type,
              title,
              message,
              entity_type,
              entity_id
            )
            VALUES
            (
              $1::integer,
              $2::varchar,
              $3::varchar,
              $4::text,
              $5::varchar,
              $6::integer
            )
            `,
            [
              nextReviewerId,
              'TASK_REVIEW',
              nextTitle,
              nextMessage,
              'TASK',
              id
            ]
          );
        }
      }
    }

    /*
     * =====================================================
     * 8. COMMIT
     * =====================================================
     */

    await client.query(
      'COMMIT'
    );

    /*
     * =====================================================
     * 9. AUDIT LOG
     * =====================================================
     */

    await audit(
      req.user?.userId,
      'REVIEW_TASK',
      'TASK',
      id,
      {
        decision:
          normalizedDecision,

        comment:
          reviewerComment,

        submissionId:
          submission.id,

        reviewerRole:
          role,

        reviewerEmployeeId:
          reviewerEmployeeId
      }
    );

    /*
     * =====================================================
     * RESPONSE
     * =====================================================
     */

    return res.json({
      message:
        `Task ${normalizedDecision.toLowerCase()} successfully.`,
      status:
        newStatus,
      reviewerRole:
        role,
      decision:
        normalizedDecision
    });

  } catch (e) {

    await client.query(
      'ROLLBACK'
    );

    throw e;

  } finally {

    client.release();
  }
}

export async function taskReviewHistory(
  req: Request,
  res: Response
) {
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({
      message: 'Invalid task id.'
    });
  }

  /*
   * =====================================================
   * GET TASK + ACCESS SCOPE
   * =====================================================
   */
  const taskResult = await query<any>(
    `
    SELECT
      t.id,
      t.assigned_to,
      t.created_by,
      t.created_at,
      t.completed_at,
      e.team_lead_id
    FROM tasks t
    LEFT JOIN employees e
      ON e.id = t.assigned_to
    WHERE t.id = $1::integer
    `,
    [id]
  );

  if (!taskResult.rows[0]) {
    return res.status(404).json({
      message: 'Task not found.'
    });
  }

  const task = taskResult.rows[0];
  const role = req.user!.role;
  const employeeId = req.user!.employeeId;

  /*
   * Keep the existing history access rules.
   */
  if (
    role === 'EMPLOYEE' &&
    Number(task.assigned_to) !== Number(employeeId)
  ) {
    return res.status(403).json({
      message: 'You can view history only for your own tasks.'
    });
  }

  if (role === 'TEAM_LEAD') {
    const isOwnTask =
      Number(task.assigned_to) === Number(employeeId) ||
      Number(task.created_by) === Number(employeeId);
    const isTeamTask = Number(task.team_lead_id) === Number(employeeId);

    if (!isOwnTask && !isTeamTask) {
      const teamCheck = await query<any>(
        'SELECT id FROM employees WHERE id=$1 AND team_lead_id=$2',
        [task.assigned_to, employeeId]
      );
      if (!teamCheck.rows[0]) {
        return res.status(403).json({
          message:
            'You can view history only for tasks assigned to you or under your supervision.'
        });
      }
    }
  }

  /*
   * =====================================================
   * COMPLETE TASK HISTORY
   * =====================================================
   *
   * The history is assembled from the existing audit points:
   *   1. Task creation
   *   2. Task status changes
   *   3. Every completion submission / resubmission
   *   4. Every hierarchy review decision
   *      (APPROVED / NEEDS_CHANGES / REJECTED / SKIPPED)
   *
   * No review workflow is changed here; this endpoint only
   * reads the existing records and presents them chronologically.
   */
  const historyResult = await query<any>(
    `
    SELECT *
    FROM (
      /* -------------------------------------------------
       * TASK CREATED
       * ------------------------------------------------- */
      SELECT
        'TASK_CREATED'::varchar AS event_type,
        t.created_at AS event_at,
        t.created_by::integer AS actor_id,
        COALESCE(
          creator.first_name || ' ' || creator.last_name,
          'System'
        ) AS actor_name,
        'SYSTEM'::varchar AS actor_role,
        NULL::integer AS submission_id,
        NULL::integer AS review_id,
        NULL::varchar AS decision,
        NULL::varchar AS old_status,
        NULL::varchar AS new_status,
        NULL::text AS comment,
        NULL::text AS proof_type,
        NULL::text AS proof_url,
        NULL::text AS completion_summary,
        NULL::integer AS submission_number,
        NULL::jsonb AS changes
      FROM tasks t
      LEFT JOIN employees creator
        ON creator.id = t.created_by
      WHERE t.id = $1::integer

      UNION ALL

      /* -------------------------------------------------
       * TASK STATUS CHANGES
       * ------------------------------------------------- */
      SELECT
        'STATUS_CHANGED'::varchar AS event_type,
        tsh.changed_at AS event_at,
        tsh.changed_by::integer AS actor_id,
        COALESCE(
          actor.first_name || ' ' || actor.last_name,
          'System'
        ) AS actor_name,
        COALESCE(u.role, 'SYSTEM')::varchar AS actor_role,
        NULL::integer AS submission_id,
        NULL::integer AS review_id,
        NULL::varchar AS decision,
        tsh.old_status,
        tsh.new_status,
        tsh.reason::text AS comment,
        NULL::text AS proof_type,
        NULL::text AS proof_url,
        NULL::text AS completion_summary,
        NULL::integer AS submission_number,
        NULL::jsonb AS changes
      FROM task_status_history tsh
      LEFT JOIN employees actor
        ON actor.id = tsh.changed_by
      LEFT JOIN users u
        ON u.employee_id = tsh.changed_by
      WHERE tsh.task_id = $1::integer

      UNION ALL

      /* -------------------------------------------------
       * EVERY SUBMISSION / RESUBMISSION
       * ------------------------------------------------- */
      SELECT
        'SUBMISSION'::varchar AS event_type,
        cs.submitted_at AS event_at,
        cs.submitted_by::integer AS actor_id,
        COALESCE(
          submitter.first_name || ' ' || submitter.last_name,
          'Unknown'
        ) AS actor_name,
        COALESCE(u.role, 'EMPLOYEE')::varchar AS actor_role,
        cs.id AS submission_id,
        NULL::integer AS review_id,
        NULL::varchar AS decision,
        NULL::varchar AS old_status,
        'SUBMITTED'::varchar AS new_status,
        NULL::text AS comment,
        cs.proof_type::text AS proof_type,
        cs.proof_url::text AS proof_url,
        cs.completion_summary::text AS completion_summary,
        ROW_NUMBER() OVER (
          PARTITION BY cs.task_id
          ORDER BY cs.submitted_at ASC, cs.id ASC
        )::integer AS submission_number,
        NULL::jsonb AS changes
      FROM task_completion_submissions cs
      LEFT JOIN employees submitter
        ON submitter.id = cs.submitted_by
      LEFT JOIN users u
        ON u.employee_id = cs.submitted_by
      WHERE cs.task_id = $1::integer

      UNION ALL

      /* -------------------------------------------------
       * EVERY REVIEW DECISION
       * ------------------------------------------------- */
      SELECT
        'REVIEW'::varchar AS event_type,
        tr.reviewed_at AS event_at,
        tr.reviewer_id::integer AS actor_id,
        COALESCE(
          reviewer.first_name || ' ' || reviewer.last_name,
          tr.reviewer_role
        ) AS actor_name,
        tr.reviewer_role::varchar AS actor_role,
        tr.submission_id,
        tr.id AS review_id,
        tr.decision::varchar AS decision,
        NULL::varchar AS old_status,
        NULL::varchar AS new_status,
        tr.comment::text AS comment,
        NULL::text AS proof_type,
        NULL::text AS proof_url,
        NULL::text AS completion_summary,
        NULL::integer AS submission_number,
        NULL::jsonb AS changes
      FROM task_reviews tr
      LEFT JOIN employees reviewer
        ON reviewer.id = tr.reviewer_id
      WHERE tr.task_id = $1::integer
        AND tr.reviewed_at IS NOT NULL

      UNION ALL

      /* -------------------------------------------------
       * TASK EDITS
       * ------------------------------------------------- */
      SELECT
        'EDITED'::varchar AS event_type,
        teh.edited_at AS event_at,
        teh.edited_by::integer AS actor_id,
        COALESCE(editor.first_name || ' ' || editor.last_name, 'System') AS actor_name,
        COALESCE(u.role, 'SYSTEM')::varchar AS actor_role,
        NULL::integer AS submission_id,
        NULL::integer AS review_id,
        NULL::varchar AS decision,
        NULL::varchar AS old_status,
        NULL::varchar AS new_status,
        'Task details edited'::text AS comment,
        NULL::text AS proof_type,
        NULL::text AS proof_url,
        NULL::text AS completion_summary,
        NULL::integer AS submission_number,
        teh.changes::jsonb AS changes
      FROM task_edit_history teh
      LEFT JOIN employees editor ON editor.id = teh.edited_by
      LEFT JOIN users u ON u.employee_id = teh.edited_by
      WHERE teh.task_id = $1::integer
    ) history
    ORDER BY
      history.event_at ASC NULLS LAST,
      history.event_type ASC,
      COALESCE(history.review_id, history.submission_id, history.actor_id, 0) ASC
    `,
    [id]
  );

  /*
   * The final verification is the existing task.completed_at.
   * reviewTask() sets this when Super Admin approves, so no
   * new timestamp or workflow mutation is required.
   */
  const history = historyResult.rows.map(
    (item: any, index: number) => ({
      ...item,
      sequence: index + 1
    })
  );

  return res.json({
    history,
    final_verification_at: task.completed_at || null
  });
}


export async function adminUpdateTask(req: Request, res: Response) {
  const id = Number(req.params.id), b = req.body;
  const beforeResult = await query<any>('SELECT * FROM tasks WHERE id=$1', [id]);
  if (!beforeResult.rows[0]) return res.status(404).json({ message: 'Task not found' });
  const before = beforeResult.rows[0];

  const assignedTo = numOrNull(b.assignedTo);
  const taskType = String(b.taskType || before.task_type || 'TECHNICAL').toUpperCase();
  if (!['TECHNICAL', 'NON_TECHNICAL'].includes(taskType)) {
    return res.status(400).json({ message: 'Invalid task type.' });
  }

  const r = await query<any>(
    `UPDATE tasks SET title=COALESCE($1,title),description=$2,assigned_to=COALESCE($3,assigned_to),priority=COALESCE($4,priority),task_type=$5,start_date=$6,due_date=$7,status=COALESCE($8,status),progress=COALESCE($9,progress),attachment_url=$10,completed_at=CASE WHEN COALESCE($8,status)='COMPLETED' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=$11 RETURNING *`,
    [b.title || null, textOrNull(b.description), assignedTo, b.priority || null, taskType, b.startDate || null, b.dueDate || null, b.status || null, b.progress === '' || b.progress === undefined ? null : Number(b.progress), textOrNull(b.attachmentUrl), id]
  );
  const after = r.rows[0];

  const changes = buildTaskEditChanges(before, after);
  if (Object.keys(changes).length) {
    await query(
      `INSERT INTO task_edit_history(task_id,edited_by,changes) VALUES($1,$2,$3::jsonb)`,
      [id, req.user!.employeeId, JSON.stringify(changes)]
    );
  }

  if (before.status !== after.status) {
    await query(
      `INSERT INTO task_status_history(task_id,old_status,new_status,changed_by,reason) VALUES($1,$2,$3,$4,$5)`,
      [id, before.status, after.status, req.user!.employeeId, 'Task edited.']
    );
  }

  if (
    Object.keys(changes).length &&
    after.assigned_to &&
    after.status !== 'DRAFT'
  ) {
    await query(
      `INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id) VALUES($1,'TASK_UPDATED','Task updated',$2,'TASK',$3)`,
      [after.assigned_to, after.title, String(id)]
    );
  }

  await audit(req.user?.userId, 'UPDATE', 'TASK', id, { ...b, changes });
  res.json(after);
}
export async function deleteTask(req: Request, res: Response) {
  const id = Number(req.params.id); const r = await query<any>('DELETE FROM tasks WHERE id=$1 RETURNING id,title', [id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Task not found' });
  await audit(req.user?.userId, 'DELETE', 'TASK', id, { title: r.rows[0].title }); res.json({ ok: true });
}

export async function attendanceToday(req: Request, res: Response) {
  let id = req.user!.employeeId;
  if (isManager(req.user!.role) && req.query.employeeId) id = Number(req.query.employeeId);
  if (req.user!.role === 'TEAM_LEAD' && id && !(await requireTeamAuthority(req, id))) return res.status(403).json({ message: 'This employee is outside your team.' });

  const r = await query<any>(`
    SELECT
      a.id,
      COALESCE(a.employee_id, e.id) AS employee_id,
      COALESCE(a.work_date, current_date) AS work_date,
      a.status,
      a.attendance_mode,
      a.check_in,
      a.check_out,
      a.total_hours,
      a.check_in_lat,
      a.check_in_lng,
      a.location_accuracy,
      a.location_verified,
      a.location_text,
      CASE
        WHEN a.check_in IS NOT NULL THEN COALESCE(a.required_work_hours, target.required_work_hours)
        ELSE target.required_work_hours
      END::numeric AS required_work_hours,
      (CASE
        WHEN a.check_in IS NOT NULL THEN COALESCE(a.required_work_hours, target.required_work_hours)
        ELSE target.required_work_hours
      END * 60.0)::numeric AS required_work_minutes,
      CASE
        WHEN a.check_in IS NULL THEN 0
        WHEN a.check_out IS NOT NULL THEN COALESCE(a.total_hours, 0)
        ELSE ROUND((EXTRACT(EPOCH FROM (now() - a.check_in))/3600)::numeric, 2)
      END AS worked_hours,
      CASE
        WHEN a.check_in IS NULL THEN 0
        WHEN a.check_out IS NOT NULL THEN COALESCE(a.total_hours * 60, 0)
        ELSE ROUND((EXTRACT(EPOCH FROM (now() - a.check_in))/60)::numeric, 0)
      END AS worked_minutes
    FROM employees e
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=current_date AND dwh.scope='EMPLOYEE' AND dwh.scope_id=e.id ORDER BY dwh.id DESC LIMIT 1),
        (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=current_date AND dwh.scope='TEAM' AND dwh.scope_id=e.team_lead_id ORDER BY dwh.id DESC LIMIT 1),
        (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=current_date AND dwh.scope='DEPARTMENT' AND dwh.scope_id=e.department_id ORDER BY dwh.id DESC LIMIT 1),
        (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=current_date AND dwh.scope='DEFAULT' ORDER BY dwh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='EMPLOYEE' AND wh.scope_id=e.id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='TEAM' AND wh.scope_id=e.team_lead_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEPARTMENT' AND wh.scope_id=e.department_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEFAULT' ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'performance_default_daily_required_minutes' LIMIT 1),
        (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'minimum_work_minutes' LIMIT 1),
        8.00
      )::numeric AS required_work_hours
    ) target
    LEFT JOIN attendance a
      ON a.employee_id = e.id
     AND a.work_date = current_date
    WHERE e.id = $1
  `, [id]);

  res.json(r.rows[0] || null);
}
export async function checkIn(req: Request, res: Response) {
  const emp = req.user!.employeeId; if (!emp) return res.status(400).json({ message: 'Employee profile required' });
  const mode = String(req.body.mode || '').toUpperCase();
  if (!['ONLINE', 'OFFLINE'].includes(mode)) return res.status(400).json({ message: 'Select Online or Offline attendance mode.' });
  const { latitude, longitude, accuracy } = req.body;
  const s = await query<any>("SELECT key,value FROM system_settings WHERE key IN ('office_latitude','office_longitude','geofence_radius_m','late_after_time','office_address')");
  const settings = Object.fromEntries(s.rows.map((x: any) => [x.key, x.value]));
  let verified = false, distance: null | number = null, locationText = mode === 'ONLINE' ? 'Online / Remote' : null;
  if (mode === 'OFFLINE') {
    if (latitude == null || longitude == null) return res.status(400).json({ message: 'Location permission is required for Offline attendance.' });
    if (!settings.office_latitude || !settings.office_longitude) return res.status(409).json({ message: 'Office location is not configured. Ask Admin/Super Admin to set company coordinates first.' });
    distance = haversineMeters(Number(latitude), Number(longitude), Number(settings.office_latitude), Number(settings.office_longitude));
    const radius = Number(settings.geofence_radius_m || 300);
    if (distance > radius) return res.status(403).json({ message: `Offline attendance requires office presence. You are approximately ${Math.round(distance)}m from the configured office; allowed radius is ${radius}m.` });
    verified = true;
    locationText = `${Number(latitude).toFixed(6)}, ${Number(longitude).toFixed(6)}${settings.office_address ? ` • ${settings.office_address}` : ''}`;
  }
  const lateTime = String(settings.late_after_time || '10:15').split(':').map(Number);
  const now = new Date(); const late = now.getHours() > lateTime[0] || (now.getHours() === lateTime[0] && now.getMinutes() > lateTime[1]);
  const effectiveHours = await getEffectiveWorkHours(emp);
  const r = await query<any>(`INSERT INTO attendance(employee_id,work_date,status,attendance_mode,check_in,check_in_lat,check_in_lng,location_accuracy,location_verified,location_text,required_work_hours) VALUES($1,current_date,$2,$3,now(),$4,$5,$6,$7,$8,$9) ON CONFLICT(employee_id,work_date) DO UPDATE SET check_in=COALESCE(attendance.check_in,EXCLUDED.check_in),status=CASE WHEN attendance.status='LEAVE' THEN 'LEAVE' ELSE EXCLUDED.status END,attendance_mode=EXCLUDED.attendance_mode,check_in_lat=$4,check_in_lng=$5,location_accuracy=$6,location_verified=$7,location_text=$8,required_work_hours=CASE WHEN attendance.check_in IS NULL THEN EXCLUDED.required_work_hours ELSE COALESCE(attendance.required_work_hours,EXCLUDED.required_work_hours) END RETURNING *`, [emp, late ? 'LATE' : 'PRESENT', mode, mode === 'OFFLINE' ? latitude : null, mode === 'OFFLINE' ? longitude : null, mode === 'OFFLINE' ? accuracy || null : null, verified, locationText, effectiveHours]);
  await audit(req.user?.userId, 'CHECK_IN', 'ATTENDANCE', r.rows[0].id, { mode, distance, locationVerified: verified });
  res.json(r.rows[0]);
}
export async function checkOut(req: Request, res: Response) {
  const emp = req.user!.employeeId;
  const cur = await query<any>('SELECT * FROM attendance WHERE employee_id=$1 AND work_date=current_date', [emp]);
  if (!cur.rows[0]?.check_in) return res.status(400).json({ message: 'Check in first.' });

  let lat = null, lng = null;

  // ONLINE attendance is remote and does not require GPS for checkout.
  // OFFLINE attendance must be checked out from inside the office geofence.
  if (cur.rows[0].attendance_mode === 'OFFLINE') {
    if (req.body.latitude == null || req.body.longitude == null) {
      return res.status(400).json({
        message: 'Location permission is required to check out from Offline attendance.'
      });
    }

    const s = await query<any>(
      "SELECT key,value FROM system_settings WHERE key IN ('office_latitude','office_longitude','geofence_radius_m','office_address')"
    );
    const settings = Object.fromEntries(
      s.rows.map((x: any) => [x.key, x.value])
    );

    if (!settings.office_latitude || !settings.office_longitude) {
      return res.status(409).json({
        message: 'Office location is not configured. Ask Admin/Super Admin to set company coordinates first.'
      });
    }

    lat = Number(req.body.latitude);
    lng = Number(req.body.longitude);
    const distance = haversineMeters(
      lat,
      lng,
      Number(settings.office_latitude),
      Number(settings.office_longitude)
    );
    const radius = Number(settings.geofence_radius_m || 300);

    // Offline checkout is allowed only while physically inside the office geofence.
    if (distance > radius) {
      return res.status(403).json({
        message: `Checkout is allowed only inside the office premises. You are approximately ${Math.round(distance)}m from the configured office; allowed radius is ${radius}m.`
      });
    }
  }

  const r = await query<any>(
    `UPDATE attendance SET check_out=now(),check_out_lat=$1,check_out_lng=$2,total_hours=ROUND((EXTRACT(EPOCH FROM(now()-check_in))/3600)::numeric,2) WHERE id=$3 RETURNING *`,
    [lat, lng, cur.rows[0].id]
  );
  await audit(req.user?.userId, 'CHECK_OUT', 'ATTENDANCE', r.rows[0].id, {
    mode: cur.rows[0].attendance_mode
  });
  res.json(r.rows[0]);
}
export async function listAttendance(req: Request, res: Response) {
  const {
    month = '',
    year = '',
    date = '',
    department = '',
    employeeId = '',
    mode = '',
    status = '',
    search = ''
  } = req.query as any;
  const p: any[] = [];
  let w = 'WHERE 1=1';

  // Support both formats:
  //   /attendance?month=2026-09
  //   /attendance?month=9&year=2026
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  const normalizedMonth =
    yearNumber >= 2000 && monthNumber >= 1 && monthNumber <= 12
      ? `${yearNumber}-${String(monthNumber).padStart(2, '0')}`
      : String(month || '').trim();

  if (req.user!.role === 'EMPLOYEE') {
    p.push(req.user!.employeeId);
    w += ` AND a.employee_id=$${p.length}`;
  } else if (req.user!.role === 'TEAM_LEAD') {
    p.push(req.user!.employeeId);
    // Team Leads see their own attendance plus attendance of their team.
    w += ` AND (a.employee_id=$${p.length} OR e.team_lead_id=$${p.length})`;
  }

  if (/^\d{4}-\d{2}$/.test(normalizedMonth)) {
    p.push(`${normalizedMonth}-01`);
    w += ` AND a.work_date>=date_trunc('month',$${p.length}::date)
           AND a.work_date<(date_trunc('month',$${p.length}::date)+interval '1 month')`;
  }
  if (date) { p.push(date); w += ` AND a.work_date=$${p.length}::date`; }
  if (department) { p.push(Number(department)); w += ` AND e.department_id=$${p.length}`; }
  if (employeeId) { p.push(Number(employeeId)); w += ` AND e.id=$${p.length}`; }
  if (mode) { p.push(mode); w += ` AND a.attendance_mode=$${p.length}`; }
  if (status) { p.push(status); w += ` AND a.status=$${p.length}`; }
  if (search) {
    p.push(`%${search}%`);
    w += ` AND (e.first_name ILIKE $${p.length} OR e.last_name ILIKE $${p.length} OR e.employee_code ILIKE $${p.length} OR COALESCE(d.name,'') ILIKE $${p.length} OR a.attendance_mode ILIKE $${p.length} OR a.status ILIKE $${p.length})`;
  }

  const r = await query<any>(`
    SELECT
      a.id,
      to_char(a.work_date, 'YYYY-MM-DD') AS work_date,
      a.employee_id,
      a.status,
      a.attendance_mode,
      a.check_in,
      a.check_out,
      a.check_in_lat,
      a.check_in_lng,
      a.check_out_lat,
      a.check_out_lng,
      a.location_accuracy,
      a.location_verified,
      a.location_text,
      a.notes,
      e.employee_code,
      e.user_type,
      e.first_name||' '||e.last_name employee_name,
      u.id user_id,
      d.name department_name,
      COALESCE(a.required_work_hours, target.required_work_hours)::numeric AS required_work_hours,
      (COALESCE(a.required_work_hours, target.required_work_hours) * 60.0)::numeric AS required_work_minutes,
      CASE
        WHEN a.check_in IS NULL THEN 0
        WHEN a.check_out IS NOT NULL THEN COALESCE(a.total_hours, 0)
        WHEN a.work_date < current_date THEN
          ROUND(COALESCE(a.required_work_hours, target.required_work_hours) / 2, 2)
        ELSE ROUND((EXTRACT(EPOCH FROM (now() - a.check_in))/3600)::numeric, 2)
      END AS worked_hours,
      CASE
        WHEN a.check_in IS NULL THEN 0
        WHEN a.check_out IS NOT NULL THEN COALESCE(a.total_hours * 60, 0)
        WHEN a.work_date < current_date THEN
          ROUND((COALESCE(a.required_work_hours, target.required_work_hours) / 2) * 60, 0)
        ELSE ROUND((EXTRACT(EPOCH FROM (now() - a.check_in))/60)::numeric, 0)
      END AS worked_minutes,
      (
        a.check_in IS NOT NULL
        AND a.check_out IS NULL
        AND a.work_date < current_date
      ) AS checkout_missed,
      CASE
        WHEN a.check_in IS NOT NULL
         AND a.check_out IS NULL
         AND a.work_date < current_date
        THEN 'Half Day • Checkout missed'
        ELSE NULL
      END AS attendance_note
    FROM attendance a
    JOIN employees e ON e.id=a.employee_id
    LEFT JOIN users u ON u.employee_id=e.id
    LEFT JOIN departments d ON d.id=e.department_id
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=a.work_date AND dwh.scope='EMPLOYEE' AND dwh.scope_id=e.id ORDER BY dwh.id DESC LIMIT 1),
        (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=a.work_date AND dwh.scope='TEAM' AND dwh.scope_id=e.team_lead_id ORDER BY dwh.id DESC LIMIT 1),
        (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=a.work_date AND dwh.scope='DEPARTMENT' AND dwh.scope_id=e.department_id ORDER BY dwh.id DESC LIMIT 1),
        (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=a.work_date AND dwh.scope='DEFAULT' ORDER BY dwh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='EMPLOYEE' AND wh.scope_id=e.id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='TEAM' AND wh.scope_id=e.team_lead_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEPARTMENT' AND wh.scope_id=e.department_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEFAULT' ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'performance_default_daily_required_minutes' LIMIT 1),
        (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'minimum_work_minutes' LIMIT 1),
        8.00
      )::numeric AS required_work_hours
    ) target
    ${w}
    ORDER BY a.work_date DESC, a.check_in DESC NULLS LAST, a.id DESC
    LIMIT 500
  `, p);

  res.json(r.rows);
}

export async function submitReport(req: Request, res: Response) {
  const emp = req.user!.employeeId;
  const { completed, tasksWorked, hoursWorked, blockers, tomorrowPlan, comments, reportDate } = req.body;
  if (!completed) return res.status(400).json({ message: 'Completed work is required' });
  const r = await query<any>(`
    INSERT INTO daily_reports(employee_id,report_date,completed_work,tasks_worked,hours_worked,blockers,tomorrow_plan,comments)
    VALUES($1,COALESCE($2::date,current_date),$3,$4,$5,$6,$7,$8)
    ON CONFLICT(employee_id,report_date) DO UPDATE SET
      completed_work=$3,tasks_worked=$4,hours_worked=$5,blockers=$6,tomorrow_plan=$7,comments=$8,
      review_status='PENDING',review_comment=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now()
    RETURNING *`, [emp, reportDate || null, completed, textOrNull(tasksWorked), hoursWorked || null, textOrNull(blockers), textOrNull(tomorrowPlan), textOrNull(comments)]);
  await query('DELETE FROM daily_report_reviews WHERE report_id=$1', [r.rows[0].id]);
  await audit(req.user?.userId, 'SUBMIT', 'DAILY_REPORT', r.rows[0].id);
  res.json(r.rows[0]);
}

export async function listReports(req: Request, res: Response) {
  const p: any[] = []; let w = 'WHERE 1=1';
  const role = req.user!.role; const me = req.user!.employeeId;
  if (role === 'EMPLOYEE') { p.push(me); w += ` AND r.employee_id=$${p.length}`; }
  else if (role === 'TEAM_LEAD') { p.push(me); w += ` AND (r.employee_id=$${p.length} OR e.team_lead_id=$${p.length})`; }
  else if (role === 'ADMIN') { p.push(me); w += ` AND r.employee_id<>$${p.length}`; }
  const rr = await query<any>(`
    SELECT r.*,e.employee_code,e.user_type,e.first_name||' '||e.last_name employee_name,
           d.name department_name,u.role employee_role,
           rv_tl.decision team_lead_decision,rv_a.decision admin_decision,rv_s.decision super_admin_decision
    FROM daily_reports r JOIN employees e ON e.id=r.employee_id
    LEFT JOIN users u ON u.employee_id=e.id LEFT JOIN departments d ON d.id=e.department_id
    LEFT JOIN daily_report_reviews rv_tl ON rv_tl.report_id=r.id AND rv_tl.reviewer_role='TEAM_LEAD'
    LEFT JOIN daily_report_reviews rv_a ON rv_a.report_id=r.id AND rv_a.reviewer_role='ADMIN'
    LEFT JOIN daily_report_reviews rv_s ON rv_s.report_id=r.id AND rv_s.reviewer_role='SUPER_ADMIN'
    ${w} ORDER BY r.report_date DESC LIMIT 300`, p);
  res.json(rr.rows);
}

export async function reviewReport(req: Request, res: Response) {
  const id = Number(req.params.id);
  const rawDecision = String(req.body.decision || req.body.status || '').toUpperCase();
  const decision = rawDecision === 'REVIEWED' ? 'APPROVE' : rawDecision;
  const comment = String(req.body.reviewComment || req.body.comment || '').trim();
  if (!['APPROVE','NEEDS_CHANGES','REJECT'].includes(decision)) return res.status(400).json({ message: 'Use APPROVE, NEEDS_CHANGES or REJECT.' });
  if (['NEEDS_CHANGES','REJECT'].includes(decision) && !comment) return res.status(400).json({ message: 'A comment is required for Needs Changes or Reject.' });

  const target = await query<any>(`SELECT r.*,u.role employee_role,e.team_lead_id,e.first_name||' '||e.last_name employee_name FROM daily_reports r JOIN employees e ON e.id=r.employee_id LEFT JOIN users u ON u.employee_id=e.id WHERE r.id=$1`, [id]);
  if (!target.rows[0]) return res.status(404).json({ message: 'Report not found' });
  const t=target.rows[0], role=req.user!.role, me=req.user!.employeeId;
  if (!['TEAM_LEAD','ADMIN','SUPER_ADMIN'].includes(role)) return res.status(403).json({ message: 'You do not have permission to review reports.' });
  if (t.employee_id===me) return res.status(403).json({ message: 'You cannot approve your own report.' });
  if (role==='TEAM_LEAD' && t.team_lead_id!==me) return res.status(403).json({ message: 'You can review only reports of employees/interns under your supervision.' });
  if (['REVIEWED','REJECTED','NEEDS_CHANGES'].includes(t.review_status)) return res.status(400).json({ message: `This report cannot be reviewed from ${t.review_status} status.` });
  if (role==='TEAM_LEAD' && t.review_status!=='PENDING') return res.status(400).json({ message: 'Team Lead review is no longer pending.' });
  if (role==='ADMIN' && !['PENDING','APPROVED_BY_TEAM_LEAD'].includes(t.review_status)) return res.status(400).json({ message: 'Admin review is not currently available.' });
  if (role==='SUPER_ADMIN' && !['PENDING','APPROVED_BY_TEAM_LEAD','APPROVED_BY_ADMIN'].includes(t.review_status)) return res.status(400).json({ message: 'Super Admin review is not currently available.' });

  let newStatus='PENDING';
  if(decision==='NEEDS_CHANGES') newStatus='NEEDS_CHANGES';
  else if(decision==='REJECT') newStatus='REJECTED';
  else if(role==='TEAM_LEAD') newStatus='APPROVED_BY_TEAM_LEAD';
  else if(role==='ADMIN') newStatus='APPROVED_BY_ADMIN';
  else newStatus='REVIEWED';

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`INSERT INTO daily_report_reviews(report_id,reviewer_role,reviewer_id,decision,comment,reviewed_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(report_id,reviewer_role) DO UPDATE SET reviewer_id=EXCLUDED.reviewer_id,decision=EXCLUDED.decision,comment=EXCLUDED.comment,reviewed_at=now()`,[id,role,me,decision==='APPROVE'?'APPROVED':decision==='REJECT'?'REJECTED':decision,comment||null]);
    if(decision==='APPROVE' && role==='ADMIN') await client.query(`INSERT INTO daily_report_reviews(report_id,reviewer_role,decision,reviewed_at) VALUES($1,'TEAM_LEAD','SKIPPED',now()) ON CONFLICT(report_id,reviewer_role) DO NOTHING`,[id]);
    if(decision==='APPROVE' && role==='SUPER_ADMIN'){
      await client.query(`INSERT INTO daily_report_reviews(report_id,reviewer_role,decision,reviewed_at) VALUES($1,'TEAM_LEAD','SKIPPED',now()) ON CONFLICT(report_id,reviewer_role) DO NOTHING`,[id]);
      await client.query(`INSERT INTO daily_report_reviews(report_id,reviewer_role,decision,reviewed_at) VALUES($1,'ADMIN','SKIPPED',now()) ON CONFLICT(report_id,reviewer_role) DO NOTHING`,[id]);
    }
    const rr=await client.query<any>('UPDATE daily_reports SET review_status=$1,review_comment=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 RETURNING *',[newStatus,comment||null,me,id]);
    const title=decision==='APPROVE'?(newStatus==='REVIEWED'?'Report finally approved':'Report approved'):decision==='NEEDS_CHANGES'?'Report needs changes':'Report rejected';
    await client.query(`INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id) VALUES($1,'REPORT_REVIEW',$2,$3,'DAILY_REPORT',$4)`,[t.employee_id,title,comment||`${t.employee_name}'s report was reviewed by ${role.replace('_',' ')}.`,String(id)]);
    if(decision==='APPROVE' && role!=='SUPER_ADMIN'){
      const nextRole=role==='TEAM_LEAD'?'ADMIN':'SUPER_ADMIN';
      const nr=await client.query<any>(`SELECT employee_id FROM users WHERE role=$1 AND is_active=true AND employee_id IS NOT NULL ORDER BY id LIMIT 1`,[nextRole]);
      if(nr.rows[0]?.employee_id) await client.query(`INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id) VALUES($1,'REPORT_REVIEW','Report awaiting review',$2,'DAILY_REPORT',$3)`,[nr.rows[0].employee_id,`${t.employee_name}'s daily report is awaiting ${nextRole.replace('_',' ')} review.`,String(id)]);
    }
    await client.query('COMMIT');
    await audit(req.user?.userId,'REVIEW','DAILY_REPORT',id,{decision,role,newStatus});
    res.json(rr.rows[0]);
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function adminUpdateReport(req: Request, res: Response) {
  const id = Number(req.params.id); const { completed, tasksWorked, hoursWorked, blockers, tomorrowPlan, comments, reportDate } = req.body;
  const r = await query<any>(`UPDATE daily_reports SET report_date=COALESCE($1::date,report_date),completed_work=COALESCE($2,completed_work),tasks_worked=$3,hours_worked=$4,blockers=$5,tomorrow_plan=$6,comments=$7,updated_at=now() WHERE id=$8 RETURNING *`, [reportDate || null, completed || null, textOrNull(tasksWorked), hoursWorked || null, textOrNull(blockers), textOrNull(tomorrowPlan), textOrNull(comments), id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Report not found' }); await audit(req.user?.userId, 'UPDATE', 'DAILY_REPORT', id, req.body); res.json(r.rows[0]);
}
export async function deleteReport(req: Request, res: Response) { const id = Number(req.params.id); const r = await query<any>('DELETE FROM daily_reports WHERE id=$1 RETURNING id', [id]); if (!r.rows[0]) return res.status(404).json({ message: 'Report not found' }); await audit(req.user?.userId, 'DELETE', 'DAILY_REPORT', id); res.json({ ok: true }); }

export async function applyLeave(req: Request, res: Response) {
  const { type, startDate, endDate, reason, referenceLink } = req.body;
  const leaveType = String(type || '').toUpperCase();
  if (!['PAID', 'SICK', 'UNPAID'].includes(leaveType) || !startDate || !endDate || !reason) {
    return res.status(400).json({ message: 'Leave type, dates and reason are required. Leave type must be PAID, SICK or UNPAID.' });
  }
  if (String(endDate) < String(startDate)) return res.status(400).json({ message: 'To Date cannot be earlier than From Date.' });
  const r = await query<any>('INSERT INTO leave_requests(employee_id,leave_type,start_date,end_date,reason,reference_link) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.user!.employeeId, leaveType, startDate, endDate, reason, textOrNull(referenceLink)]);
  await audit(req.user?.userId, 'APPLY', 'LEAVE', r.rows[0].id);
  res.status(201).json(r.rows[0]);
}
export async function listLeaves(req: Request, res: Response) {
  const p: any[] = []; let w = 'WHERE 1=1';
  if (req.user!.role === 'EMPLOYEE') { p.push(req.user!.employeeId); w += ` AND l.employee_id=$${p.length}`; }
  else if (req.user!.role === 'TEAM_LEAD') { p.push(req.user!.employeeId); w += ` AND (l.employee_id=$${p.length} OR e.team_lead_id=$${p.length})`; }
  const r = await query<any>(`
    SELECT
      l.*,
      e.employee_code,
      e.user_type,
      e.first_name || ' ' || e.last_name AS employee_name,
      d.name AS department_name,
      u.role AS employee_role,
      reviewer.first_name || ' ' || reviewer.last_name AS reviewed_by_name,
      reviewer_user.role AS reviewed_by_role
    FROM leave_requests l
    JOIN employees e ON e.id=l.employee_id
    LEFT JOIN users u ON u.employee_id=e.id
    LEFT JOIN departments d ON d.id=e.department_id
    LEFT JOIN employees reviewer ON reviewer.id=l.reviewed_by
    LEFT JOIN users reviewer_user ON reviewer_user.employee_id=l.reviewed_by
    ${w}
    ORDER BY l.created_at DESC
  `, p); res.json(r.rows);
}
export async function decideLeave(req: Request, res: Response) {
  const id = Number(req.params.id);
  const { status, comment } = req.body;

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({
      message: 'Status must be APPROVED or REJECTED'
    });
  }

  // Leave becomes effective only after Super Admin approval/rejection.
  if (req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      message: 'Only Super Admin can approve or reject leave requests.'
    });
  }

  const target = await query<any>(
    'SELECT * FROM leave_requests WHERE id=$1',
    [id]
  );

  if (!target.rows[0]) {
    return res.status(404).json({
      message: 'Leave request not found'
    });
  }

  const r = await query<any>(
    `UPDATE leave_requests
     SET status=$1,
         review_comment=$2,
         reviewed_by=$3,
         reviewed_at=now()
     WHERE id=$4
     RETURNING *`,
    [
      status,
      textOrNull(comment),
      req.user!.employeeId,
      id
    ]
  );

  if (status === 'APPROVED') {
    // Keep approved leave visible in Attendance, but never create Sunday rows.
    // Performance later distinguishes PAID (no deduction) from SICK/UNPAID (deduction).
    await query(
      `INSERT INTO attendance(
         employee_id,
         work_date,
         status,
         attendance_mode,
         location_text
       )
       SELECT
         $1,
         d::date,
         'LEAVE',
         'OFFLINE',
         'Approved ' || $4 || ' leave'
       FROM generate_series($2::date,$3::date,'1 day') d
       WHERE EXTRACT(DOW FROM d::date) <> 0
       ON CONFLICT(employee_id,work_date)
       DO UPDATE SET
         status='LEAVE',
         attendance_mode='OFFLINE',
         location_text='Approved ' || $4 || ' leave'`,
      [
        r.rows[0].employee_id,
        r.rows[0].start_date,
        r.rows[0].end_date,
        String(r.rows[0].leave_type || 'leave').toUpperCase()
      ]
    );
  }

  await query(
    `INSERT INTO notifications(
       employee_id,
       type,
       title,
       message,
       entity_type,
       entity_id
     )
     VALUES($1,$2,$3,$4,'LEAVE',$5)`,
    [
      r.rows[0].employee_id,
      'LEAVE_' + status,
      'Leave request ' + status.toLowerCase(),
      comment || `Your leave request was ${status.toLowerCase()}.`,
      String(id)
    ]
  );

  await audit(
    req.user?.userId,
    status,
    'LEAVE',
    id
  );

  res.json(r.rows[0]);
}

export async function updateLeaveRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  const { type, startDate, endDate, reason, referenceLink } = req.body;
  const leaveType = type ? String(type).toUpperCase() : null;
  if (leaveType && !['PAID', 'SICK', 'UNPAID'].includes(leaveType)) return res.status(400).json({ message: 'Leave type must be PAID, SICK or UNPAID.' });
  if (startDate && endDate && String(endDate) < String(startDate)) return res.status(400).json({ message: 'To Date cannot be earlier than From Date.' });
  const r = await query<any>(
    `UPDATE leave_requests
     SET leave_type=COALESCE($1,leave_type),
         start_date=COALESCE($2::date,start_date),
         end_date=COALESCE($3::date,end_date),
         reason=COALESCE($4,reason),
         reference_link=CASE WHEN $5::text IS NULL THEN reference_link ELSE NULLIF($5::text,'') END
     WHERE id=$6 RETURNING *`,
    [leaveType, startDate || null, endDate || null, reason || null, referenceLink ?? null, id]
  );
  if (!r.rows[0]) return res.status(404).json({ message: 'Leave request not found' });
  await audit(req.user?.userId, 'UPDATE', 'LEAVE', id, req.body);
  res.json(r.rows[0]);
}
export async function deleteLeave(req: Request, res: Response) { const id = Number(req.params.id); const r = await query<any>('DELETE FROM leave_requests WHERE id=$1 RETURNING id', [id]); if (!r.rows[0]) return res.status(404).json({ message: 'Leave request not found' }); await audit(req.user?.userId, 'DELETE', 'LEAVE', id); res.json({ ok: true }); }

/* =========================================================
   WORK HOURS CONFIGURATION
   Priority: INDIVIDUAL > TEAM > DEPARTMENT > DEFAULT
   ========================================================= */

async function getEffectiveWorkHours(employeeId: number) {
  const r = await query<any>(`
    SELECT COALESCE(
      (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=current_date AND dwh.scope='EMPLOYEE' AND dwh.scope_id=e.id ORDER BY dwh.id DESC LIMIT 1),
      (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=current_date AND dwh.scope='TEAM' AND dwh.scope_id=e.team_lead_id ORDER BY dwh.id DESC LIMIT 1),
      (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=current_date AND dwh.scope='DEPARTMENT' AND dwh.scope_id=e.department_id ORDER BY dwh.id DESC LIMIT 1),
      (SELECT dwh.hours FROM work_hours_date_overrides dwh WHERE dwh.effective_date=current_date AND dwh.scope='DEFAULT' ORDER BY dwh.id DESC LIMIT 1),
      (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='EMPLOYEE' AND wh.scope_id=e.id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
      (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='TEAM' AND wh.scope_id=e.team_lead_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
      (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEPARTMENT' AND wh.scope_id=e.department_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
      (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEFAULT' ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
      (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'performance_default_daily_required_minutes' LIMIT 1),
      (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'minimum_work_minutes' LIMIT 1),
      8.00
    )::numeric AS hours
    FROM employees e
    WHERE e.id=$1
  `, [employeeId]);
  const hours = Number(r.rows[0]?.hours);
  return Number.isFinite(hours) && hours > 0 ? hours : 8;
}

async function getEffectiveWorkHoursForDate(
  employeeId: number,
  dateText: string,
  fallbackMinutes = 480
) {
  const r = await query<any>(`
    SELECT COALESCE(
      (
        SELECT a.required_work_hours
        FROM attendance a
        WHERE a.employee_id=e.id
          AND a.work_date=$2::date
          AND a.required_work_hours IS NOT NULL
        LIMIT 1
      ),
      (
        SELECT dwh.hours
        FROM work_hours_date_overrides dwh
        WHERE dwh.effective_date=$2::date
          AND dwh.scope='EMPLOYEE'
          AND dwh.scope_id=e.id
        ORDER BY dwh.id DESC
        LIMIT 1
      ),
      (
        SELECT dwh.hours
        FROM work_hours_date_overrides dwh
        WHERE dwh.effective_date=$2::date
          AND dwh.scope='TEAM'
          AND dwh.scope_id=e.team_lead_id
        ORDER BY dwh.id DESC
        LIMIT 1
      ),
      (
        SELECT dwh.hours
        FROM work_hours_date_overrides dwh
        WHERE dwh.effective_date=$2::date
          AND dwh.scope='DEPARTMENT'
          AND dwh.scope_id=e.department_id
        ORDER BY dwh.id DESC
        LIMIT 1
      ),
      (
        SELECT dwh.hours
        FROM work_hours_date_overrides dwh
        WHERE dwh.effective_date=$2::date
          AND dwh.scope='DEFAULT'
        ORDER BY dwh.id DESC
        LIMIT 1
      ),
      (
        SELECT wh.hours
        FROM work_hours_settings wh
        WHERE wh.scope='EMPLOYEE'
          AND wh.scope_id=e.id
        ORDER BY wh.updated_at DESC, wh.id DESC
        LIMIT 1
      ),
      (
        SELECT wh.hours
        FROM work_hours_settings wh
        WHERE wh.scope='TEAM'
          AND wh.scope_id=e.team_lead_id
        ORDER BY wh.updated_at DESC, wh.id DESC
        LIMIT 1
      ),
      (
        SELECT wh.hours
        FROM work_hours_settings wh
        WHERE wh.scope='DEPARTMENT'
          AND wh.scope_id=e.department_id
        ORDER BY wh.updated_at DESC, wh.id DESC
        LIMIT 1
      ),
      (
        SELECT wh.hours
        FROM work_hours_settings wh
        WHERE wh.scope='DEFAULT'
        ORDER BY wh.updated_at DESC, wh.id DESC
        LIMIT 1
      ),
      (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'performance_default_daily_required_minutes' LIMIT 1),
      (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'minimum_work_minutes' LIMIT 1),
      ($3::numeric / 60.0)
    )::numeric AS hours
    FROM employees e
    WHERE e.id=$1
  `, [employeeId, dateText, fallbackMinutes]);

  const hours = Number(r.rows[0]?.hours);
  return Number.isFinite(hours) && hours > 0
    ? hours
    : fallbackMinutes / 60;
}

export function countWorkingDaysInMonth(year: number, month: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month - 1, day);
    if (d.getDay() !== 0) {
      workingDays++;
    }
  }
  return Math.max(1, workingDays);
}

async function getPerformanceConfig(monthNumber?: number, yearNumber?: number) {
  const [sRes, whRes] = await Promise.all([
    query<any>(`
      SELECT key, value
      FROM system_settings
      WHERE key IN (
        'performance_default_daily_required_minutes',
        'performance_task_deadline_days',
        'performance_task_late_deduction_per_day',
        'minimum_work_minutes'
      )
    `),
    query<any>(`
      SELECT hours
      FROM work_hours_settings
      WHERE scope='DEFAULT'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `)
  ]);

  const settings = Object.fromEntries(
    sRes.rows.map((row: any) => [row.key, row.value])
  );

  const numberOrDefault = (value: any, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const now = new Date();
  const y = Number(yearNumber) || now.getFullYear();
  const m = Number(monthNumber) || (now.getMonth() + 1);
  const dynamicTotalWorkingDays = countWorkingDaysInMonth(y, m);

  const defaultHours = Number(whRes.rows[0]?.hours);
  const defaultDailyRequiredMinutes =
    Number.isFinite(defaultHours) && defaultHours > 0
      ? defaultHours * 60
      : numberOrDefault(
          settings.performance_default_daily_required_minutes,
          numberOrDefault(settings.minimum_work_minutes, 480)
        );

  return {
    totalWorkingDays: dynamicTotalWorkingDays,
    defaultDailyRequiredMinutes,
    taskDeadlineDays: Math.max(
      0,
      Math.floor(
        numberOrDefault(
          settings.performance_task_deadline_days,
          5
        )
      )
    ),
    taskLateDeductionPerDay: Math.min(
      100,
      Math.max(
        0,
        numberOrDefault(
          settings.performance_task_late_deduction_per_day,
          20
        )
      )
    )
  };
}

export async function listWorkHours(req: Request, res: Response) {
  if (req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      message: 'Only Super Admin can access work-hours settings.'
    });
  }
const r = await query<any>(`
  SELECT
    x.id,
    x.scope,
    x.scope_id,
    x.hours,
    x.created_by,
    x.created_at,
    x.updated_at,
    x.setting_type,
    x.effective_date,
    x.target_name,
    x.current_hours
  FROM (
    SELECT
      wh.id,
      wh.scope,
      wh.scope_id,
      wh.hours,
      wh.created_by,
      wh.created_at,
      wh.updated_at,
      'GENERAL'::text AS setting_type,
      NULL::date AS effective_date,
      CASE
        WHEN wh.scope='DEFAULT' THEN 'Default'
        WHEN wh.scope='DEPARTMENT' THEN COALESCE(d.name,'Department')
        WHEN wh.scope='TEAM' THEN COALESCE(tl.first_name || ' ' || tl.last_name,'Team')
        WHEN wh.scope='EMPLOYEE' THEN COALESCE(e.first_name || ' ' || e.last_name,'Employee')
        ELSE wh.scope
      END AS target_name,
      wh.hours AS current_hours,

      1 AS setting_type_sort,

      CASE wh.scope
        WHEN 'DEFAULT' THEN 1
        WHEN 'DEPARTMENT' THEN 2
        WHEN 'TEAM' THEN 3
        WHEN 'EMPLOYEE' THEN 4
        ELSE 5
      END AS scope_sort

    FROM work_hours_settings wh

    LEFT JOIN departments d
      ON wh.scope='DEPARTMENT'
      AND d.id=wh.scope_id

    LEFT JOIN employees tl
      ON wh.scope='TEAM'
      AND tl.id=wh.scope_id

    LEFT JOIN employees e
      ON wh.scope='EMPLOYEE'
      AND e.id=wh.scope_id

    UNION ALL

    SELECT
      dwh.id,
      dwh.scope,
      dwh.scope_id,
      dwh.hours,
      dwh.created_by,
      dwh.created_at,
      dwh.updated_at,
      'DATE'::text AS setting_type,
      dwh.effective_date,

      CASE
        WHEN dwh.scope='DEFAULT' THEN 'Default'
        WHEN dwh.scope='DEPARTMENT' THEN COALESCE(d.name,'Department')
        WHEN dwh.scope='TEAM' THEN COALESCE(tl.first_name || ' ' || tl.last_name,'Team')
        WHEN dwh.scope='EMPLOYEE' THEN COALESCE(e.first_name || ' ' || e.last_name,'Employee')
        ELSE dwh.scope
      END AS target_name,

      dwh.hours AS current_hours,

      2 AS setting_type_sort,

      CASE dwh.scope
        WHEN 'DEFAULT' THEN 1
        WHEN 'DEPARTMENT' THEN 2
        WHEN 'TEAM' THEN 3
        WHEN 'EMPLOYEE' THEN 4
        ELSE 5
      END AS scope_sort

    FROM work_hours_date_overrides dwh

    LEFT JOIN departments d
      ON dwh.scope='DEPARTMENT'
      AND d.id=dwh.scope_id

    LEFT JOIN employees tl
      ON dwh.scope='TEAM'
      AND tl.id=dwh.scope_id

    LEFT JOIN employees e
      ON dwh.scope='EMPLOYEE'
      AND e.id=dwh.scope_id
  ) x

  ORDER BY
    x.setting_type_sort,
    x.scope_sort,
    x.effective_date NULLS FIRST,
    x.target_name
`);

  res.json(r.rows);
}
export async function saveWorkHours(req: Request, res: Response) {
  if (req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      message: 'Only Super Admin can modify work-hours settings.'
    });
  }

  const scope = String(
    req.body.scope || ''
  ).toUpperCase();

  const scopeId =
    req.body.scopeId === '' ||
    req.body.scopeId === null ||
    req.body.scopeId === undefined
      ? null
      : Number(req.body.scopeId);

  const hours =
    Number(req.body.hours);

  const effectiveDate =
    req.body.effectiveDate === '' ||
    req.body.effectiveDate === null ||
    req.body.effectiveDate === undefined
      ? null
      : String(req.body.effectiveDate).trim();

  if (!['DEFAULT','DEPARTMENT','TEAM','EMPLOYEE'].includes(scope)) {
    return res.status(400).json({
      message: 'Invalid work-hours scope.'
    });
  }

  if (
    scope !== 'DEFAULT' &&
    (
      scopeId === null ||
      !Number.isInteger(scopeId) ||
      scopeId <= 0
    )
  ) {
    return res.status(400).json({
      message: 'A valid target is required.'
    });
  }

  if (
    !Number.isFinite(hours) ||
    hours <= 0 ||
    hours > 24
  ) {
    return res.status(400).json({
      message:
        'Work hours must be greater than 0 and no more than 24 hours.'
    });
  }

  if (
    effectiveDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
  ) {
    return res.status(400).json({
      message:
        'Please provide a valid date in YYYY-MM-DD format.'
    });
  }

  const targetId = scopeId as number;

  if (scope === 'DEPARTMENT') {
    const x = await query<any>(
      'SELECT 1 FROM departments WHERE id=$1',
      [targetId]
    );

    if (!x.rows[0]) {
      return res.status(404).json({
        message: 'Department not found.'
      });
    }
  }

  if (scope === 'TEAM') {
    const x = await query<any>(
      `SELECT 1
       FROM employees
       WHERE id=$1
         AND EXISTS (
           SELECT 1
           FROM users u
           WHERE u.employee_id=employees.id
             AND u.role='TEAM_LEAD'
         )`,
      [targetId]
    );

    if (!x.rows[0]) {
      return res.status(404).json({
        message: 'Team lead not found.'
      });
    }
  }

  if (scope === 'EMPLOYEE') {
    const x = await query<any>(
      'SELECT 1 FROM employees WHERE id=$1',
      [targetId]
    );

    if (!x.rows[0]) {
      return res.status(404).json({
        message: 'Employee not found.'
      });
    }
  }

  if (effectiveDate) {
    if (scope === 'DEFAULT') {
      const r = await query<any>(
        `INSERT INTO work_hours_date_overrides(
           effective_date,
           scope,
           scope_id,
           hours,
           created_by
         )
         VALUES($1::date,'DEFAULT',NULL,$2,$3)
         ON CONFLICT (effective_date,scope)
         WHERE scope='DEFAULT'
         DO UPDATE SET
           hours=EXCLUDED.hours,
           updated_at=now()
         RETURNING *`,
        [
          effectiveDate,
          hours,
          req.user!.employeeId
        ]
      );

      await audit(
        req.user?.userId,
        'UPDATE',
        'WORK_HOURS',
        r.rows[0]?.id || null,
        {
          scope,
          hours,
          effectiveDate
        }
      );

      return res.json(r.rows[0]);
    }

    const r = await query<any>(
      `INSERT INTO work_hours_date_overrides(
         effective_date,
         scope,
         scope_id,
         hours,
         created_by
       )
       VALUES($1::date,$2,$3,$4,$5)
       ON CONFLICT (effective_date,scope,scope_id)
       DO UPDATE SET
         hours=EXCLUDED.hours,
         updated_at=now()
       RETURNING *`,
      [
        effectiveDate,
        scope,
        targetId,
        hours,
        req.user!.employeeId
      ]
    );

    await audit(
      req.user?.userId,
      'UPDATE',
      'WORK_HOURS',
      r.rows[0]?.id || null,
      {
        scope,
        scopeId: targetId,
        hours,
        effectiveDate
      }
    );

    return res.json(r.rows[0]);
  }

  if (scope === 'DEFAULT') {
    await query(`
      INSERT INTO system_settings(key, value)
      VALUES
        ('performance_default_daily_required_minutes', ($1 * 60.0)::text),
        ('minimum_work_minutes', ($1 * 60.0)::text)
      ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
    `, [hours]);

    const r = await query<any>(
      `UPDATE work_hours_settings
       SET hours=$1,
           updated_at=now(),
           created_by=COALESCE(created_by,$2)
       WHERE scope='DEFAULT'
       RETURNING *`,
      [hours, req.user!.employeeId]
    );

    if (r.rows[0]) {
      await audit(
        req.user?.userId,
        'UPDATE',
        'WORK_HOURS',
        r.rows[0].id,
        { scope, hours }
      );
      return res.json(r.rows[0]);
    }

    const r2 = await query<any>(
      `INSERT INTO work_hours_settings(
         scope,scope_id,hours,created_by
       )
       VALUES('DEFAULT',NULL,$1,$2)
       RETURNING *`,
      [
        hours,
        req.user!.employeeId
      ]
    );

    await audit(
      req.user?.userId,
      'CREATE',
      'WORK_HOURS',
      r2.rows[0].id,
      { scope, hours }
    );

    return res.status(201).json(r2.rows[0]);
  }

  const r = await query<any>(
    `INSERT INTO work_hours_settings(
       scope,scope_id,hours,created_by
     )
     VALUES($1,$2,$3,$4)
     ON CONFLICT (scope,scope_id)
     WHERE scope <> 'DEFAULT'
     DO UPDATE SET
       hours=EXCLUDED.hours,
       updated_at=now()
     RETURNING *`,
    [
      scope,
      targetId,
      hours,
      req.user!.employeeId
    ]
  );

  await audit(
    req.user?.userId,
    'UPDATE',
    'WORK_HOURS',
    r.rows[0]?.id || null,
    {
      scope,
      scopeId: targetId,
      hours
    }
  );

  res.json(r.rows[0]);
}

export async function deleteWorkHours(req: Request, res: Response) {
  if (req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ message: 'Only Super Admin can modify work-hours settings.' });
  }
  const id=Number(req.params.id);
  const r=await query<any>(`DELETE FROM work_hours_settings WHERE id=$1 AND scope <> 'DEFAULT' RETURNING *`,[id]);
  if(!r.rows[0]) return res.status(404).json({message:'Work-hours override not found.'});
  await audit(req.user?.userId,'DELETE','WORK_HOURS',id,{scope:r.rows[0].scope,scopeId:r.rows[0].scope_id});
  res.json({ok:true});
}

function dateOnlyValue(value: any) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || '').slice(0, 10);
}

function shiftDate(dateText: string, days: number) {
  const [year, month, day] = dateText.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isSaturday(dateText: string) {
  const [year, month, day] = dateText.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 6;
}

function isSunday(dateText: string) {
  const [year, month, day] = dateText.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0;
}

function isWithinLeave(dateText: string, leaves: Array<{ start_date: any; end_date: any }>) {
  return leaves.some((leave) => {
    const start = dateOnlyValue(leave.start_date);
    const end = dateOnlyValue(leave.end_date);
    return dateText >= start && dateText <= end;
  });
}

function countNeutralLeaveDaysAfterDueDate(
  dueDate: Date,
  referenceDate: Date,
  leaves: Array<{ start_date: any; end_date: any }>
) {
  if (!leaves.length || referenceDate <= dueDate) return 0;

  const first = dueDate.toISOString().slice(0, 10);
  const last = referenceDate.toISOString().slice(0, 10);
  let count = 0;
  let cursor = shiftDate(first, 1);

  while (cursor <= last) {
    if (isWithinLeave(cursor, leaves)) count += 1;
    cursor = shiftDate(cursor, 1);
  }

  return count;
}

export async function markAbsencesForDate(dateText?: string) {
  const dateResult = await query<any>(
    `SELECT COALESCE($1::date, current_date - interval '1 day')::date::text AS target_date`,
    [dateText || null]
  );

  const targetDate = dateOnlyValue(dateResult.rows[0]?.target_date);

  if (!targetDate || isSunday(targetDate)) {
    return {
      date: targetDate,
      markedAbsent: 0,
      markedLeave: 0
    };
  }

  const employees = await query<any>(
    `SELECT id
     FROM employees
     WHERE status='ACTIVE'
       AND joining_date <= $1::date
     ORDER BY id`,
    [targetDate]
  );

  let markedAbsent = 0;
  let markedLeave = 0;

  for (const employee of employees.rows) {
    const employeeId = Number(employee.id);

    const existing = await query<any>(
      `SELECT id
       FROM attendance
       WHERE employee_id=$1
         AND work_date=$2::date
       LIMIT 1`,
      [employeeId, targetDate]
    );

    if (existing.rows[0]) continue;

    const leave = await query<any>(
      `SELECT leave_type
       FROM leave_requests
       WHERE employee_id=$1
         AND status='APPROVED'
         AND $2::date BETWEEN start_date AND end_date
       ORDER BY
         CASE WHEN leave_type='PAID' THEN 1 ELSE 2 END,
         id DESC
       LIMIT 1`,
      [employeeId, targetDate]
    );

    if (leave.rows[0]) {
      await query(
        `INSERT INTO attendance(
           employee_id,
           work_date,
           status,
           attendance_mode,
           location_text
         )
         VALUES(
           $1,
           $2::date,
           'LEAVE',
           'OFFLINE',
           $3
         )
         ON CONFLICT(employee_id,work_date) DO NOTHING`,
        [
          employeeId,
          targetDate,
          `Approved ${String(leave.rows[0].leave_type).toUpperCase()} leave`
        ]
      );

      markedLeave += 1;
      continue;
    }

    await query(
      `INSERT INTO attendance(
         employee_id,
         work_date,
         status,
         attendance_mode,
         location_text
       )
       VALUES(
         $1,
         $2::date,
         'ABSENT',
         'OFFLINE',
         'Automatically marked absent at end of working day'
       )
       ON CONFLICT(employee_id,work_date) DO NOTHING`,
      [employeeId, targetDate]
    );

    markedAbsent += 1;
  }

  return {
    date: targetDate,
    markedAbsent,
    markedLeave
  };
}


export async function performance(req: Request, res: Response) {
  const requestedEmployeeId = Number(req.query.employeeId || 0);
  const requestedMonth = Number(req.query.month || 0);
  const requestedYear = Number(req.query.year || 0);

  let targets: number[] = [];

  if (req.user!.role === 'EMPLOYEE') {
    targets = [req.user!.employeeId!];
  } else if (requestedEmployeeId) {
    if (
      req.user!.role === 'TEAM_LEAD' &&
      !(await requireTeamAuthority(req, requestedEmployeeId))
    ) {
      return res.status(403).json({
        message: 'This employee is outside your team.'
      });
    }
    targets = [requestedEmployeeId];
  } else if (req.user!.role === 'TEAM_LEAD') {
    const team = await query<any>(
      `SELECT id
       FROM employees
       WHERE (id=$1 OR team_lead_id=$1)
         AND status <> 'INACTIVE'
       ORDER BY id`,
      [req.user!.employeeId]
    );
    targets = team.rows.map((row: any) => Number(row.id));
  } else {
    const employees = await query<any>(
      `SELECT id
       FROM employees
       WHERE status <> 'INACTIVE'
       ORDER BY id`
    );
    targets = employees.rows.map((row: any) => Number(row.id));
  }

  targets = targets.filter(Number.isFinite);

  if (!targets.length) {
    return res.status(400).json({
      message: 'No employees available for performance calculation.'
    });
  }

  const safeNumber = (value: any, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const clampPercent = (value: any) =>
    Math.max(0, Math.min(100, safeNumber(value, 0)));

  const dateResult = await query<any>(
    'SELECT current_date::text AS current_date'
  );

  const systemCurrentDate = dateOnlyValue(
    dateResult.rows[0]?.current_date || new Date()
  );

  const currentDateObj = new Date(
    `${systemCurrentDate}T00:00:00Z`
  );

  const calculationMonth =
    requestedMonth >= 1 && requestedMonth <= 12
      ? requestedMonth
      : currentDateObj.getUTCMonth() + 1;

  const calculationYear =
    requestedYear >= 2000 && requestedYear <= 2100
      ? requestedYear
      : currentDateObj.getUTCFullYear();

  const config = await getPerformanceConfig(calculationMonth, calculationYear);

  const monthStart =
    `${calculationYear}-${String(calculationMonth).padStart(2, '0')}-01`;

  const monthEnd = dateOnlyValue(
    new Date(Date.UTC(calculationYear, calculationMonth, 0))
  );

  const isCurrentMonth =
    calculationYear === currentDateObj.getUTCFullYear() &&
    calculationMonth === currentDateObj.getUTCMonth() + 1;

  const calculationEnd =
    isCurrentMonth
      ? systemCurrentDate
      : monthEnd;

  const calculated: any[] = [];

  for (const target of targets) {
    const employeeMeta = await query<any>(
      `SELECT
         joining_date::text AS joining_date,
         to_jsonb(e) AS employee_data
       FROM employees e
       WHERE e.id=$1`,
      [target]
    );

    const joiningDate =
      employeeMeta.rows[0]?.joining_date
        ? dateOnlyValue(
            employeeMeta.rows[0].joining_date
          )
        : null;

    const periodStart =
      joiningDate && joiningDate > monthStart
        ? joiningDate
        : monthStart;

    const employeeData =
      employeeMeta.rows[0]?.employee_data || {};

    const payCandidates = [
      ['salary', 'Salary'],
      ['salary_amount', 'Salary'],
      ['monthly_salary', 'Salary'],
      ['base_salary', 'Salary'],
      ['stipend', 'Stipend'],
      ['stipend_amount', 'Stipend'],
      ['base_pay', 'Base Pay'],
      ['compensation_amount', 'Base Pay']
    ];

    let basePay: number | null = null;
    let basePayLabel = 'Salary / Stipend';

    for (const [key, label] of payCandidates) {
      const value = Number(employeeData?.[key]);

      if (
        Number.isFinite(value) &&
        value >= 0
      ) {
        basePay = value;
        basePayLabel = String(label);
        break;
      }
    }

    const [
      attendanceResult,
      leaveResult,
      taskResult,
      dailyResult
    ] = await Promise.all([
      query<any>(
        `SELECT
           work_date::text AS work_date,
           status,
           check_in,
           check_out,
           CASE
             WHEN check_in IS NULL THEN 0
             WHEN check_out IS NOT NULL THEN
               GREATEST(
                 EXTRACT(EPOCH FROM (check_out - check_in)) / 60.0,
                 0
               )
             ELSE
               GREATEST(
                 EXTRACT(EPOCH FROM (now() - check_in)) / 60.0,
                 0
               )
           END AS worked_minutes
         FROM attendance
         WHERE employee_id=$1
           AND work_date BETWEEN $2::date AND $3::date
         ORDER BY work_date`,
        [target, periodStart, calculationEnd]
      ),
      query<any>(
        `SELECT
           start_date::text AS start_date,
           end_date::text AS end_date,
           leave_type
         FROM leave_requests
         WHERE employee_id=$1
           AND status='APPROVED'
           AND end_date >= $2::date
           AND start_date <= $3::date
         ORDER BY start_date`,
        [target, periodStart, calculationEnd]
      ),
      query<any>(
        `SELECT
           t.id,
           t.title,
           t.task_type,
           t.start_date::text AS start_date,
           t.due_date::text AS due_date,
           t.created_at::text AS created_at,
           t.completed_at,
           t.status,
           cs.submitted_at AS completion_submitted_at,
           (
             cs.id IS NOT NULL
             OR t.status IN ('SUBMITTED', 'COMPLETED', 'REJECTED', 'NEEDS_CHANGES')
             OR t.completed_at IS NOT NULL
           ) AS is_submitted
         FROM tasks t
         LEFT JOIN LATERAL (
           SELECT id, submitted_at
           FROM task_completion_submissions
           WHERE task_id = t.id
           ORDER BY submitted_at DESC, id DESC
           LIMIT 1
         ) cs ON true
         WHERE t.assigned_to=$1
           AND t.status NOT IN ('CANCELLED','DRAFT')
           AND COALESCE(t.start_date, t.created_at::date) <= $3::date
           AND (
             t.due_date IS NULL
             OR t.due_date::date >= $2::date
           )
         ORDER BY
           COALESCE(t.start_date::date, t.created_at::date) ASC,
           COALESCE(t.due_date::date, '9999-12-31'::date) ASC,
           t.created_at ASC,
           t.id ASC`,
        [target, periodStart, calculationEnd]
      ),
      query<any>(
        `SELECT
           work_date::text AS work_date,
           required_minutes,
           worked_minutes,
           missing_minutes,
           attendance_percentage,
           deduction_percentage
         FROM performance_attendance_daily
         WHERE employee_id=$1
           AND work_date BETWEEN $2::date AND $3::date
         ORDER BY work_date`,
        [target, periodStart, calculationEnd]
      )
    ]);

    const attendanceByDate = new Map<string, any>();

    for (const row of attendanceResult.rows) {
      const date = dateOnlyValue(row.work_date);

      attendanceByDate.set(date, {
        ...row,
        worked_minutes: Math.max(
          0,
          safeNumber(row.worked_minutes, 0)
        )
      });
    }

    /*
     * Required minutes are snapshotted per date.
     * A later work-hours change therefore cannot rewrite an
     * existing daily performance baseline.
     */
    const requiredMinutesByDate = new Map<string, number>();

    for (const row of dailyResult.rows) {
      requiredMinutesByDate.set(
        dateOnlyValue(row.work_date),
        Math.max(
          0,
          safeNumber(
            row.required_minutes,
            config.defaultDailyRequiredMinutes
          )
        )
      );
    }

    const attendanceDaily: any[] = [];

    const approvedLeaveForDate = (date: string) =>
      leaveResult.rows.find((leave: any) => {
        const start = dateOnlyValue(leave.start_date);
        const end = dateOnlyValue(leave.end_date);
        return start <= date && end >= date;
      });

    /*
     * Attendance deduction is intentionally based ONLY on:
     *   1. an attendance row explicitly marked ABSENT, or
     *   2. an APPROVED UNPAID leave day.
     *
     * PRESENT/LATE/HALF-DAY records do not create an attendance
     * deduction here. APPROVED paid/other leave is neutral and creates
     * no deduction. The day remains part of the configured 26-day pool.
     *
     * The deduction is still minute-based: a qualifying missed day
     * contributes that day's required minutes divided by the total
     * required minutes for the configured working-day pool.
     */
    /*
     * The attendance deduction pool is always based on the configured
     * working-day pool. With the default 26 working days and 180 minutes
     * per day, one full qualifying day is:
     *
     *   180 / (26 * 180) * 100 = 3.846153...%
     *
     * Do NOT rebuild this denominator from the number of dates that have
     * elapsed in the selected month. Otherwise one leave/absence can
     * incorrectly become a much larger percentage such as 7.82%.
     *
     * Date-specific required-minute overrides are still respected for the
     * missed-minute amount, but the configured working-day pool remains the
     * attendance deduction baseline.
     */
    const totalRequiredMinutes =
      Math.max(
        0,
        config.totalWorkingDays *
          config.defaultDailyRequiredMinutes
      );

    let qualifyingMissingMinutes = 0;
    let totalWorkedMinutes = 0;

    const resolvedAttendanceDays: any[] = [];

    for (
      let cursor = periodStart;
      cursor <= calculationEnd;
      cursor = shiftDate(cursor, 1)
    ) {
      if (isSunday(cursor)) continue;

      let requiredMinutes =
        requiredMinutesByDate.get(cursor);

      if (requiredMinutes === undefined) {
        requiredMinutes = Math.max(
          0,
          safeNumber(
            (
              await getEffectiveWorkHoursForDate(
                target,
                cursor,
                config.defaultDailyRequiredMinutes
              )
            ) * 60,
            config.defaultDailyRequiredMinutes
          )
        );
      }

      const record = attendanceByDate.get(cursor);
      const approvedLeave = approvedLeaveForDate(cursor);
      const leaveType = String(
        approvedLeave?.leave_type || ''
      ).toUpperCase();

      const isApprovedUnpaidLeave =
        leaveType === 'UNPAID';

      const isApprovedNeutralLeave =
        !!approvedLeave && !isApprovedUnpaidLeave;

      const isMarkedAbsent =
        String(record?.status || '').toUpperCase() === 'ABSENT';

      let workedMinutes = 0;
      let missingMinutes = 0;
      let effectiveStatus = record?.status || 'NO_RECORD';

      if (isApprovedUnpaidLeave) {
        effectiveStatus = 'LEAVE';
        workedMinutes = 0;
        missingMinutes = requiredMinutes;
      } else if (isApprovedNeutralLeave) {
        effectiveStatus = 'LEAVE';
        workedMinutes = requiredMinutes;
        missingMinutes = 0;
      } else if (isMarkedAbsent) {
        effectiveStatus = 'ABSENT';
        workedMinutes = 0;
        missingMinutes = requiredMinutes;
      } else if (record) {
        const hasCheckIn = !!record.check_in;
        const hasCheckOut = !!record.check_out;
        const checkoutMissed = !!record.checkout_missed || (hasCheckIn && !hasCheckOut && cursor < systemCurrentDate);
        const statusUpper = String(record.status || '').toUpperCase();

        if (checkoutMissed || (hasCheckIn && !hasCheckOut && cursor < systemCurrentDate) || statusUpper === 'HALF_DAY' || statusUpper === 'HALF DAY') {
          effectiveStatus = 'HALF_DAY';
          workedMinutes = Math.round(requiredMinutes / 2);
          missingMinutes = Math.max(0, requiredMinutes - workedMinutes);
        } else if (hasCheckIn && hasCheckOut) {
          workedMinutes = Math.min(
            requiredMinutes,
            Math.max(0, safeNumber(record.worked_minutes, 0))
          );
          missingMinutes = Math.max(0, requiredMinutes - workedMinutes);
          if (missingMinutes > 0) {
            effectiveStatus = 'PARTIAL';
          } else {
            effectiveStatus = 'PRESENT';
          }
        } else {
          workedMinutes = Math.min(
            requiredMinutes,
            Math.max(0, safeNumber(record.worked_minutes, 0))
          );
          missingMinutes = Math.max(0, requiredMinutes - workedMinutes);
          effectiveStatus = missingMinutes > 0 ? (workedMinutes === 0 ? 'ABSENT' : 'PARTIAL') : 'PRESENT';
        }
      } else if (cursor < systemCurrentDate) {
        effectiveStatus = 'ABSENT';
        workedMinutes = 0;
        missingMinutes = requiredMinutes;
      } else {
        workedMinutes = 0;
        missingMinutes = 0;
      }

      totalWorkedMinutes += workedMinutes;
      qualifyingMissingMinutes += missingMinutes;

      resolvedAttendanceDays.push({
        date: cursor,
        status: effectiveStatus,
        leave_type: leaveType || null,
        attendance_deduction_eligible: missingMinutes > 0,
        required_minutes: requiredMinutes,
        worked_minutes: workedMinutes,
        missing_minutes: missingMinutes
      });
    }

    /*
     * Store one daily snapshot. Each full working day missed (ABSENT / UNPAID LEAVE)
     * deducts exactly (100 / totalWorkingDays)% (e.g. 3.846% per day for 26 days).
     * Partial attendance deducts proportionally to that day's shortfall.
     */
    const perDayWeight = 100.0 / Math.max(1, config.totalWorkingDays);

    for (const day of resolvedAttendanceDays) {
      const dailyAttendance =
        day.required_minutes > 0
          ? clampPercent(
              (day.worked_minutes / day.required_minutes) * 100
            )
          : 100;

      const dayMissedRatio =
        day.required_minutes > 0
          ? Math.min(1, Math.max(0, day.missing_minutes / day.required_minutes))
          : 0;

      const dailyDeduction = clampPercent(dayMissedRatio * perDayWeight);

      const daily = {
        ...day,
        attendance_percentage: dailyAttendance,
        deduction_percentage: dailyDeduction
      };

      attendanceDaily.push(daily);

      await query(
        `INSERT INTO performance_attendance_daily(
           employee_id,
           work_date,
           status,
           leave_type,
           required_minutes,
           worked_minutes,
           missing_minutes,
           attendance_percentage,
           deduction_percentage
         )
         VALUES($1,$2::date,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(employee_id,work_date)
         DO UPDATE SET
           status=EXCLUDED.status,
           leave_type=EXCLUDED.leave_type,
           required_minutes=EXCLUDED.required_minutes,
           worked_minutes=EXCLUDED.worked_minutes,
           missing_minutes=EXCLUDED.missing_minutes,
           attendance_percentage=EXCLUDED.attendance_percentage,
           deduction_percentage=EXCLUDED.deduction_percentage,
           updated_at=now()`,
        [
          target,
          daily.date,
          daily.status || 'PRESENT',
          daily.leave_type || null,
          daily.required_minutes,
          daily.worked_minutes,
          daily.missing_minutes,
          daily.attendance_percentage,
          daily.deduction_percentage
        ]
      );
    }

    const totalMissingMinutes = qualifyingMissingMinutes;

    // Total monthly attendance deduction is the sum of daily deductions across the month
    const totalDailyDeductionSum = attendanceDaily.reduce(
      (sum, d) => sum + safeNumber(d.deduction_percentage, 0),
      0
    );

    const attendanceDeduction = clampPercent(totalDailyDeductionSum);

    const attendancePerformance = clampPercent(
      100 - attendanceDeduction
    );

    /*
     * TASK PERFORMANCE & TASK DEDUCTION CALCULATION
     *
     * 1. Task Performance % = (Total Tasks Submitted / Total Tasks Assigned) * 100
     * 2. Task Deduction %: Each overdue day for a task contributes 20% toward the task's deduction
     *    Total Task Deduction = (Sum of all task overdue deductions) / (Total Number of Tasks)
     */
    const taskDetails: any[] = [];
    const taskCount = taskResult.rows.length;
    let submittedTaskCount = 0;
    let totalTaskOverdueDeductionSum = 0;

    for (const task of taskResult.rows) {
      const taskStart =
        task.start_date
          ? dateOnlyValue(task.start_date)
          : dateOnlyValue(task.created_at);

      const dueDate = task.due_date ? dateOnlyValue(task.due_date) : null;
      const isSubmitted = !!task.is_submitted;
      if (isSubmitted) {
        submittedTaskCount += 1;
      }

      // Finish date for overdue day calculation
      const finishDate =
        task.completion_submitted_at
          ? dateOnlyValue(task.completion_submitted_at)
          : (task.completed_at
            ? dateOnlyValue(task.completed_at)
            : calculationEnd);

      let overdueDays = 0;
      if (dueDate && finishDate > dueDate) {
        const [dueY, dueM, dueD] = dueDate.split('-').map(Number);
        const [finY, finM, finD] = finishDate.split('-').map(Number);
        const dueUtc = Date.UTC(dueY, dueM - 1, dueD);
        const finUtc = Date.UTC(finY, finM - 1, finD);
        if (finUtc > dueUtc) {
          overdueDays = Math.floor((finUtc - dueUtc) / (24 * 60 * 60 * 1000));
        }
      }

      const taskOverdueDeduction = clampPercent(
        overdueDays * safeNumber(config.taskLateDeductionPerDay, 20)
      );

      totalTaskOverdueDeductionSum += taskOverdueDeduction;

      taskDetails.push({
        id: Number(task.id),
        title: task.title,
        task_type: task.task_type,
        start_date: taskStart,
        due_date: dueDate,
        finish_date: finishDate,
        is_submitted: isSubmitted,
        overdue_days: overdueDays,
        overdue_deduction: taskOverdueDeduction,
        score: clampPercent(100 - taskOverdueDeduction),
        status: task.status
      });
    }

    const taskTotalScore = taskDetails.reduce(
      (sum, task) => sum + safeNumber(task.score, 0),
      0
    );

    const taskPerformance =
      taskCount > 0
        ? clampPercent((submittedTaskCount / taskCount) * 100)
        : 0;

    const taskDeduction =
      taskCount > 0
        ? clampPercent(totalTaskOverdueDeductionSum / taskCount)
        : 0;

    /*
     * FINAL:
     * Attendance deduction + Task deduction.
     * Leave is no longer a separate deduction component.
     */
    const totalDeduction =
      clampPercent(
        attendanceDeduction +
          taskDeduction
      );

    const finalPayable =
      clampPercent(
        100 - totalDeduction
      );

    const finalAmount =
      basePay === null
        ? null
        : basePay *
          (finalPayable / 100);

    /*
     * Keep legacy columns populated for compatibility.
     * They do not create additional deduction components.
     */
    const averageWorkedHours =
      config.totalWorkingDays > 0
        ? (
            totalWorkedMinutes /
            60 /
            config.totalWorkingDays
          )
        : 0;

    const requiredWorkHours =
      config.defaultDailyRequiredMinutes /
      60;

    await query(
      `DELETE FROM performance_scores
       WHERE employee_id=$1
         AND period_start=$2::date`,
      [target, monthStart]
    );

    const r = await query<any>(
      `INSERT INTO performance_scores(
         employee_id,
         period_start,
         period_end,
         task_completion,
         attendance,
         working_hours,
         required_work_hours,
         task_deduction,
         leave_deduction,
         deductions,
         score,
         attendance_required_minutes,
         attendance_worked_minutes,
         attendance_missing_minutes,
         attendance_deduction,
         task_count,
         task_total_score,
         task_deadline_days,
         task_late_deduction_per_day,
         total_working_days,
         task_details,
         base_pay,
         base_pay_label
       )
       VALUES(
         $1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22
       )
       RETURNING *`,
      [
        target,
        monthStart,
        monthEnd,
        taskPerformance,
        attendancePerformance,
        averageWorkedHours,
        requiredWorkHours,
        taskDeduction,
        totalDeduction,
        finalPayable,
        totalRequiredMinutes,
        totalWorkedMinutes,
        totalMissingMinutes,
        attendanceDeduction,
        taskCount,
        taskTotalScore,
        config.taskDeadlineDays,
        config.taskLateDeductionPerDay,
        config.totalWorkingDays,
        JSON.stringify(taskDetails),
        basePay,
        basePayLabel
      ]
    );

    calculated.push({
      ...r.rows[0],
      attendance_required_minutes:
        totalRequiredMinutes,
      attendance_worked_minutes:
        totalWorkedMinutes,
      attendance_missing_minutes:
        totalMissingMinutes,
      attendance_deduction:
        attendanceDeduction,
      task_count:
        taskCount,
      task_total_score:
        taskTotalScore,
      task_performance:
        taskPerformance,
      task_deduction:
        taskDeduction,
      total_deduction:
        totalDeduction,
      final_payable:
        finalPayable,
      score:
        finalPayable,
      total_working_days:
        config.totalWorkingDays,
      default_daily_required_minutes:
        config.defaultDailyRequiredMinutes,
      task_deadline_days:
        config.taskDeadlineDays,
      task_late_deduction_per_day:
        config.taskLateDeductionPerDay,
      task_details:
        taskDetails,
      attendance_daily:
        attendanceDaily,
      base_pay:
        basePay,
      base_pay_label:
        basePayLabel,
      final_amount:
        finalAmount,
      month:
        calculationMonth,
      year:
        calculationYear
    });
  }

  res.json(
    requestedEmployeeId ||
      req.user!.role === 'EMPLOYEE'
      ? calculated[0]
      : {
          count: calculated.length,
          scores: calculated,
          month: calculationMonth,
          year: calculationYear,
          config
        }
  );
}

export async function performanceList(req: Request, res: Response) {
  const requestedEmployeeId = Number(req.query.employeeId || 0);
  const month = Number(req.query.month || 0);
  const year = Number(req.query.year || 0);

  const p: any[] = [];
  let w = 'WHERE 1=1';

  if (req.user!.role === 'EMPLOYEE') {
    p.push(req.user!.employeeId);
    w += ` AND p.employee_id=$${p.length}`;
  } else if (requestedEmployeeId) {
    if (
      req.user!.role === 'TEAM_LEAD' &&
      !(await requireTeamAuthority(req, requestedEmployeeId))
    ) {
      return res.status(403).json({ message: 'This employee is outside your team.' });
    }
    p.push(requestedEmployeeId);
    w += ` AND p.employee_id=$${p.length}`;
  } else if (req.user!.role === 'TEAM_LEAD') {
    p.push(req.user!.employeeId);
    w += ` AND (p.employee_id=$${p.length} OR e.team_lead_id=$${p.length})`;
  }

  if (month >= 1 && month <= 12) {
    p.push(month);
    w += ` AND EXTRACT(MONTH FROM p.period_start)=$${p.length}`;
  }

  if (year >= 2000 && year <= 2100) {
    p.push(year);
    w += ` AND EXTRACT(YEAR FROM p.period_start)=$${p.length}`;
  }

  // New monthly snapshots always use the first day of the selected month.
  // Keep legacy rolling-performance rows in the database, but never show
  // them in the monthly Performance view.
  w += ` AND EXTRACT(DAY FROM p.period_start)=1`;

  const r = await query<any>(
    `
    SELECT DISTINCT ON(p.employee_id)
      p.*,
      e.employee_code,
      e.user_type,
      e.first_name||' '||e.last_name employee_name,
      d.name department_name,
      CASE
        WHEN p.score='NaN'::numeric THEN 0
        ELSE COALESCE(p.score,0)
      END::numeric AS safe_score,
      COALESCE(
        p.required_work_hours,
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='EMPLOYEE' AND wh.scope_id=e.id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='TEAM' AND wh.scope_id=e.team_lead_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEPARTMENT' AND wh.scope_id=e.department_id ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT wh.hours FROM work_hours_settings wh WHERE wh.scope='DEFAULT' ORDER BY wh.updated_at DESC, wh.id DESC LIMIT 1),
        (SELECT (NULLIF(ss.value, '')::numeric / 60.0) FROM system_settings ss WHERE ss.key = 'performance_default_daily_required_minutes' LIMIT 1),
        8.00
      )::numeric AS required_work_hours,
      COALESCE(
        p.attendance_required_minutes,
        (COALESCE(p.required_work_hours, 8.00) * 60.0)
      )::numeric AS attendance_required_minutes,
      COALESCE(p.task_completion,0)::numeric AS task_performance,
      COALESCE(p.attendance,0)::numeric AS attendance_performance,
      COALESCE(
        p.attendance_deduction,
        GREATEST(0,100-COALESCE(p.attendance,0))
      )::numeric AS calculated_attendance_deduction,
      CASE
        WHEN p.task_deduction IS NULL THEN
          GREATEST(0, 100-COALESCE(p.task_completion,0))
        ELSE p.task_deduction
      END::numeric AS calculated_task_deduction,
      COALESCE(p.deductions,0)::numeric AS calculated_total_deduction,
      GREATEST(0,LEAST(100,COALESCE(p.score,0)))::numeric AS calculated_final_payable,
      COALESCE(
        daily.attendance_daily,
        '[]'::json
      ) AS attendance_daily
    FROM performance_scores p
    JOIN employees e ON e.id=p.employee_id
    LEFT JOIN departments d ON d.id=e.department_id
    LEFT JOIN LATERAL (
      SELECT json_agg(
        json_build_object(
          'work_date', x.work_date,
          'status', x.status,
          'leave_type', x.leave_type,
          'required_minutes', x.required_minutes,
          'worked_minutes', x.worked_minutes,
          'missing_minutes', x.missing_minutes,
          'attendance_percentage', x.attendance_percentage,
          'deduction_percentage', x.deduction_percentage
        )
        ORDER BY x.work_date
      ) AS attendance_daily
      FROM performance_attendance_daily x
      WHERE x.employee_id=p.employee_id
        AND x.work_date BETWEEN p.period_start AND p.period_end
    ) daily ON true
    ${w}
    ORDER BY
      p.employee_id,
      p.period_start DESC,
      p.created_at DESC,
      p.id DESC
    `,
    p
  );

  res.json(
    r.rows.map((row: any) => {
      const taskPerformance = Number(row.task_performance);
      const attendancePerformance = Number(row.attendance_performance);
      const taskDeduction = Number(row.calculated_task_deduction);
      const attendanceDeduction = Number(
        row.calculated_attendance_deduction
      );

      const totalDeduction = Math.min(
        100,
        Math.max(
          0,
          Number.isFinite(
            Number(row.calculated_total_deduction)
          )
            ? Number(row.calculated_total_deduction)
            : attendanceDeduction + taskDeduction
        )
      );

      const finalPayable = Math.max(
        0,
        Math.min(
          100,
          Number.isFinite(
            Number(row.calculated_final_payable)
          )
            ? Number(row.calculated_final_payable)
            : 100 - totalDeduction
        )
      );

      return {
        ...row,
        task_performance: Number.isFinite(taskPerformance)
          ? Math.max(0, Math.min(100, taskPerformance))
          : 0,
        attendance_performance: Number.isFinite(attendancePerformance)
          ? Math.max(0, Math.min(100, attendancePerformance))
          : 0,
        task_deduction: Number.isFinite(taskDeduction)
          ? Math.max(0, Math.min(100, taskDeduction))
          : 0,
        attendance_deduction: Number.isFinite(attendanceDeduction)
          ? Math.max(0, Math.min(100, attendanceDeduction))
          : 0,
        total_deduction: totalDeduction,
        final_payable: finalPayable,
        score: finalPayable
      };
    })
  );}
export async function deleteWorkHoursDate(req: Request, res: Response) {
  if (req.user!.role !== 'SUPER_ADMIN') {
    return res.status(403).json({
      message: 'Only Super Admin can modify work-hours settings.'
    });
  }

  const id = Number(req.params.id);

  const r = await query<any>(
    `DELETE FROM work_hours_date_overrides
     WHERE id=$1
     RETURNING *`,
    [id]
  );

  if (!r.rows[0]) {
    return res.status(404).json({
      message: 'Date-specific work-hours override not found.'
    });
  }

  await audit(
    req.user?.userId,
    'DELETE',
    'WORK_HOURS',
    id,
    {
      scope: r.rows[0].scope,
      scopeId: r.rows[0].scope_id,
      effectiveDate: r.rows[0].effective_date
    }
  );

  res.json({ ok: true });
}


/* =========================================================
   NOTIFICATIONS
========================================================= */

export async function notifications(req: Request, res: Response) {
  /*
   * Create deadline/overdue notifications for the
   * currently logged-in user before loading their inbox.
   */
  await syncDeadlineNotifications(req.user!.employeeId);

  const r = await query<any>(
    `
    SELECT
      n.*,
      e.employee_code,
      e.first_name || ' ' || e.last_name AS employee_name
    FROM notifications n
    LEFT JOIN employees e
      ON e.id = n.employee_id
    WHERE n.employee_id = $1
      AND COALESCE(n.is_deleted, false) = false
    ORDER BY n.created_at DESC
    LIMIT 300
    `,
    [req.user!.employeeId]
  );

  res.json(r.rows);
}


/* =========================================================
   UNREAD NOTIFICATION COUNT
========================================================= */

export async function unreadNotificationCount(
  req: Request,
  res: Response
) {
  /*
   * Make sure deadline / overdue notifications are also
   * included even when the Dashboard calls this endpoint
   * before the Notifications page is opened.
   */
  await syncDeadlineNotifications(req.user!.employeeId);

  const r = await query<any>(
    `
    SELECT COUNT(*)::int AS count
    FROM notifications
    WHERE employee_id = $1
      AND COALESCE(is_read, false) = false
      AND COALESCE(is_deleted, false) = false
    `,
    [req.user!.employeeId]
  );

  res.json({
    unreadCount: Number(r.rows[0]?.count || 0)
  });
}


/* =========================================================
   CLEAR ALL NOTIFICATIONS
   Only hides notifications for the logged-in user.
========================================================= */

export async function clearAllNotifications(
  req: Request,
  res: Response
) {
  const r = await query<any>(
    `
    UPDATE notifications
    SET
      is_deleted = true,
      deleted_at = now()
    WHERE employee_id = $1
      AND COALESCE(is_deleted, false) = false
    RETURNING id
    `,
    [req.user!.employeeId]
  );

  await audit(
    req.user?.userId,
    'DELETE_ALL',
    'NOTIFICATION',
    null,
    {
      count: r.rowCount || 0
    }
  );

  res.json({
    ok: true,
    count: r.rowCount || 0
  });
}


/* =========================================================
   MARK NOTIFICATION AS READ
   Only the owner can mark it as read.
========================================================= */

export async function markNotification(
  req: Request,
  res: Response
) {
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({
      message: 'Invalid notification id'
    });
  }

  const r = await query<any>(
    `
    UPDATE notifications
    SET
      is_read = true,
      read_at = COALESCE(read_at, now())
    WHERE id = $1
      AND employee_id = $2
      AND COALESCE(is_deleted, false) = false
    RETURNING id
    `,
    [
      id,
      req.user!.employeeId
    ]
  );

  if (!r.rows[0]) {
    return res.status(404).json({
      message: 'Notification not found'
    });
  }

  res.json({
    ok: true
  });
}


/* =========================================================
   DELETE ONE NOTIFICATION
   Soft delete only for the logged-in user.
========================================================= */

export async function deleteNotification(
  req: Request,
  res: Response
) {
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({
      message: 'Invalid notification id'
    });
  }

  const r = await query<any>(
    `
    UPDATE notifications
    SET
      is_deleted = true,
      deleted_at = now()
    WHERE id = $1
      AND employee_id = $2
      AND COALESCE(is_deleted, false) = false
    RETURNING id
    `,
    [
      id,
      req.user!.employeeId
    ]
  );

  if (!r.rows[0]) {
    return res.status(404).json({
      message: 'Notification not found'
    });
  }

  await audit(
    req.user?.userId,
    'DELETE',
    'NOTIFICATION',
    id
  );

  res.json({
    ok: true
  });
}


/* =========================================================
   EDIT NOTIFICATION
   Super Admin route remains protected in index.ts.
   Also restrict editing to Super Admin's own notification.
========================================================= */

export async function updateNotification(
  req: Request,
  res: Response
) {
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({
      message: 'Invalid notification id'
    });
  }

  const {
    title,
    message
  } = req.body;

  const r = await query<any>(
    `
    UPDATE notifications
    SET
      title = COALESCE($1, title),
      message = COALESCE($2, message)
    WHERE id = $3
      AND employee_id = $4
      AND COALESCE(is_deleted, false) = false
    RETURNING *
    `,
    [
      title || null,
      message || null,
      id,
      req.user!.employeeId
    ]
  );

  if (!r.rows[0]) {
    return res.status(404).json({
      message: 'Notification not found'
    });
  }

  await audit(
    req.user?.userId,
    'UPDATE',
    'NOTIFICATION',
    id
  );

  res.json(r.rows[0]);
}
export async function activity(req: Request, res: Response) {
  const { search = '', entity = '', from = '', to = '' } = req.query as any;
  const p:any[]=[]; let w='WHERE 1=1';
  if(search){p.push(`%${search}%`);w+=` AND (COALESCE(u.email,'') ILIKE $${p.length} OR COALESCE(e.first_name,'') ILIKE $${p.length} OR COALESCE(e.last_name,'') ILIKE $${p.length} OR COALESCE(e.employee_code,'') ILIKE $${p.length} OR al.action ILIKE $${p.length} OR al.entity_type ILIKE $${p.length})`;}
  if(entity){p.push(`%${entity}%`);w+=` AND al.entity_type ILIKE $${p.length}`;}
  if(from){p.push(from);w+=` AND al.created_at >= $${p.length}::date`;}
  if(to){p.push(to);w+=` AND al.created_at < ($${p.length}::date + interval '1 day')`;}
  const r=await query<any>(`SELECT al.*,u.email,e.employee_code,e.first_name||' '||e.last_name employee_name FROM activity_logs al LEFT JOIN users u ON u.id=al.user_id LEFT JOIN employees e ON e.id=u.employee_id ${w} ORDER BY al.created_at DESC LIMIT 500`,p);
  res.json(r.rows);
}
export async function getSettings(_req: Request, res: Response) { const r = await query<any>('SELECT key,value FROM system_settings ORDER BY key'); res.json(Object.fromEntries(r.rows.map((x: any) => [x.key, x.value]))); }
export async function saveSettings(req: Request, res: Response) {
  const allowed = ['company_name', 'office_address', 'office_latitude', 'office_longitude', 'geofence_radius_m', 'work_start_time', 'late_after_time', 'minimum_work_minutes', 'performance_total_working_days', 'performance_default_daily_required_minutes', 'performance_task_deadline_days', 'performance_task_late_deduction_per_day'];
  for (const [key, value] of Object.entries(req.body)) if (allowed.includes(key)) await query(`INSERT INTO system_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [key, String(value ?? '')]);
  await audit(req.user?.userId, 'UPDATE', 'SETTINGS', null, req.body); res.json({ ok: true });
}

export async function analytics(req: Request, res: Response) {
  if (req.user!.role === 'EMPLOYEE') return res.status(403).json({ message: 'Analytics requires management access' });
  const team = req.user!.role === 'TEAM_LEAD', emp = req.user!.employeeId;
  const [dept, task, attendance, performance] = await Promise.all([
    team ? query<any>(`SELECT d.name,count(e.id)::int employees FROM departments d JOIN employees e ON e.department_id=d.id WHERE e.team_lead_id=$1 GROUP BY d.id,d.name ORDER BY d.name`, [emp]) : query<any>(`SELECT d.name,count(e.id)::int employees FROM departments d LEFT JOIN employees e ON e.department_id=d.id GROUP BY d.id,d.name ORDER BY d.name`),
    team ? query<any>(`SELECT t.status,count(*)::int count FROM tasks t JOIN employees e ON e.id=t.assigned_to WHERE e.team_lead_id=$1 GROUP BY t.status ORDER BY t.status`, [emp]) : query<any>(`SELECT status,count(*)::int count FROM tasks GROUP BY status ORDER BY status`),
    team ? query<any>(`SELECT a.work_date,count(*) FILTER(WHERE a.status IN('PRESENT','LATE'))::int present,count(*)::int total FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE e.team_lead_id=$1 AND a.work_date>=current_date-interval '6 days' GROUP BY a.work_date ORDER BY a.work_date`, [emp]) : query<any>(`SELECT work_date,count(*) FILTER(WHERE status IN('PRESENT','LATE'))::int present,count(*)::int total FROM attendance WHERE work_date>=current_date-interval '6 days' GROUP BY work_date ORDER BY work_date`),
    team ? query<any>(`SELECT e.first_name||' '||e.last_name employee_name,CASE WHEN p.score = 'NaN'::numeric THEN 0 ELSE COALESCE(p.score,0) END::numeric AS score FROM performance_scores p JOIN employees e ON e.id=p.employee_id WHERE e.team_lead_id=$1 AND p.id IN(SELECT DISTINCT ON(employee_id) id FROM performance_scores ORDER BY employee_id,period_end DESC,created_at DESC) ORDER BY CASE WHEN p.score = 'NaN'::numeric THEN 0 ELSE COALESCE(p.score,0) END DESC LIMIT 10`, [emp]) : query<any>(`SELECT e.first_name||' '||e.last_name employee_name,CASE WHEN p.score = 'NaN'::numeric THEN 0 ELSE COALESCE(p.score,0) END::numeric AS score FROM performance_scores p JOIN employees e ON e.id=p.employee_id WHERE p.id IN(SELECT DISTINCT ON(employee_id) id FROM performance_scores ORDER BY employee_id,period_end DESC,created_at DESC) ORDER BY CASE WHEN p.score = 'NaN'::numeric THEN 0 ELSE COALESCE(p.score,0) END DESC LIMIT 10`)
  ]); res.json({ departments: dept.rows, tasks: task.rows, attendance: attendance.rows, performance: performance.rows });
}

export async function exportCsv(req: Request, res: Response) {
  const kind = String(req.params.kind); const team = req.user!.role === 'TEAM_LEAD'; const emp = req.user!.employeeId; let rows: any[] = [];
  if (kind === 'employees') rows = (await query<any>(`SELECT e.employee_code,e.user_type,e.first_name,e.last_name,e.email,e.phone,e.job_title,d.name department,e.joining_date,e.status FROM employees e LEFT JOIN departments d ON d.id=e.department_id ${team ? 'WHERE e.team_lead_id=$1' : ''} ORDER BY e.employee_code`, team ? [emp] : [])).rows;
  else if (kind === 'attendance') rows = (await query<any>(`SELECT a.work_date,e.employee_code,e.user_type,e.first_name||' '||e.last_name employee,d.name department,a.status,a.attendance_mode,a.check_in,a.check_out,a.total_hours,a.location_text,a.location_verified FROM attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments d ON d.id=e.department_id ${team ? 'WHERE e.team_lead_id=$1' : ''} ORDER BY a.work_date DESC`, team ? [emp] : [])).rows;
  else if (kind === 'tasks') rows = (await query<any>(`SELECT t.id,t.title,e.employee_code,e.user_type,e.first_name||' '||e.last_name assignee,d.name department,t.assignment_scope,t.priority,CASE WHEN t.due_date<now() AND t.status NOT IN('COMPLETED','CANCELLED','DRAFT') THEN 'OVERDUE' ELSE t.status END status,t.progress,t.start_date,t.due_date,t.completed_at,c.first_name||' '||c.last_name uploaded_by FROM tasks t JOIN employees e ON e.id=t.assigned_to LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees c ON c.id=t.created_by ${team ? "WHERE e.team_lead_id=$1 AND t.status <> 'DRAFT'" : "WHERE t.status <> 'DRAFT'"} ORDER BY t.created_at DESC`, team ? [emp] : [])).rows;
  else if (kind === 'performance') rows = (await query<any>(`SELECT e.employee_code,e.user_type,e.first_name||' '||e.last_name employee,p.period_start,p.period_end,p.task_completion,p.attendance,p.working_hours,p.required_work_hours,p.score FROM performance_scores p JOIN employees e ON e.id=p.employee_id ${team ? 'WHERE e.team_lead_id=$1' : ''} ORDER BY p.period_end DESC,p.created_at DESC`, team ? [emp] : [])).rows;
  else return res.status(400).json({ message: 'Unknown export type' });
  const escape = (v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`; const headers = rows[0] ? Object.keys(rows[0]) : []; const csv = [headers.map(escape).join(','), ...rows.map(row => headers.map(h => escape(row[h])).join(','))].join('\n');
  res.header('Content-Type', 'text/csv'); res.header('Content-Disposition', `attachment; filename=withx-${kind}.csv`); res.send(csv);
}

/* =========================================================
   INTERNAL MESSAGING / CHAT SYSTEM
   ========================================================= */

export async function listConversations(req: Request, res: Response) {
  const me = req.user!.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });

  const r = await query<any>(`
    SELECT
      c.id,
      c.is_group,
      c.name AS group_name,
      c.created_by AS group_created_by,
      c.created_at,
      c.updated_at,
      c.last_message_text,
      c.last_message_at,
      cp.last_read_at,
      (
        SELECT count(*)::int
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_id <> $1
          AND m.created_at > cp.last_read_at
      ) AS unread_count,
      (
        SELECT count(*)::int
        FROM conversation_participants
        WHERE conversation_id = c.id
      ) AS member_count,
      other.id AS other_user_id,
      other.employee_code AS other_user_code,
      other.first_name || ' ' || other.last_name AS other_user_name,
      other.user_type AS other_user_type,
      other.job_title AS other_user_job_title,
      COALESCE(other.photo_url, '') AS other_user_photo,
      d.name AS other_user_department,
      u.role AS other_user_role
    FROM conversations c
    JOIN conversation_participants cp
      ON cp.conversation_id = c.id
     AND cp.employee_id = $1
    LEFT JOIN conversation_participants cp_other
      ON cp_other.conversation_id = c.id
     AND cp_other.employee_id <> $1
     AND c.is_group = false
    LEFT JOIN employees other
      ON other.id = cp_other.employee_id
    LEFT JOIN users u
      ON u.employee_id = other.id
    LEFT JOIN departments d
      ON d.id = other.department_id
    ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC
  `, [me]);

  res.json(r.rows);
}

export async function createOrGetConversation(req: Request, res: Response) {
  const me = req.user!.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });

  const recipientId = Number(req.body.recipientId);
  if (!recipientId || recipientId === me) {
    return res.status(400).json({ message: 'Valid recipient employee ID required.' });
  }

  // Check if recipient exists and is active
  const recCheck = await query<any>(`
    SELECT e.id, e.first_name, e.last_name, e.team_lead_id, e.admin_id, u.role
    FROM employees e
    LEFT JOIN users u ON u.employee_id = e.id
    WHERE e.id=$1 AND e.status <> 'INACTIVE'
  `, [recipientId]);

  if (!recCheck.rows[0]) {
    return res.status(404).json({ message: 'Recipient employee not found or inactive.' });
  }

  const recipient = recCheck.rows[0];

  // Look for existing 1-on-1 conversation
  const existing = await query<any>(`
    SELECT c.id
    FROM conversations c
    JOIN conversation_participants p1 ON p1.conversation_id = c.id AND p1.employee_id = $1
    JOIN conversation_participants p2 ON p2.conversation_id = c.id AND p2.employee_id = $2
    WHERE COALESCE(c.is_group, false) = false
    LIMIT 1
  `, [me, recipientId]);

  let conversationId: number;

  if (existing.rows[0]) {
    conversationId = Number(existing.rows[0].id);
  } else {
    // Check role-based permission boundaries for initiating a new conversation
    const senderRole = req.user!.role;
    const meEmpRes = await query<any>(
      'SELECT id, team_lead_id, admin_id FROM employees WHERE id = $1',
      [me]
    );
    const meEmp = meEmpRes.rows[0];

    let isAllowed = false;

    if (senderRole === 'SUPER_ADMIN' || senderRole === 'ADMIN') {
      // Admin and Super Admin can message all employees
      isAllowed = true;
    } else if (senderRole === 'TEAM_LEAD') {
      // Team lead can message its team members, the admin assigned to it, and Super Admin
      if (
        recipient.team_lead_id === me ||
        (meEmp?.admin_id && recipient.id === meEmp.admin_id) ||
        recipient.role === 'SUPER_ADMIN'
      ) {
        isAllowed = true;
      }
    } else {
      // Members of a team (EMPLOYEE / INTERN)
      // Can message peers in the same team, their team lead, and Super Admin
      if (
        (meEmp?.team_lead_id && recipient.team_lead_id === meEmp.team_lead_id) ||
        (meEmp?.team_lead_id && recipient.id === meEmp.team_lead_id) ||
        recipient.role === 'SUPER_ADMIN'
      ) {
        isAllowed = true;
      }
    }

    if (!isAllowed) {
      return res.status(403).json({ message: 'You do not have permission to start a conversation with this employee.' });
    }

    const created = await query<any>(
      `INSERT INTO conversations(created_at, updated_at) VALUES(now(), now()) RETURNING id`
    );
    conversationId = Number(created.rows[0].id);

    await query(
      `INSERT INTO conversation_participants(conversation_id, employee_id, last_read_at)
       VALUES ($1, $2, now()), ($1, $3, now())`,
      [conversationId, me, recipientId]
    );
  }

  // Return conversation details
  const r = await query<any>(`
    SELECT
      c.id,
      c.created_at,
      c.updated_at,
      c.last_message_text,
      c.last_message_at,
      COALESCE(c.is_group, false) AS is_group,
      c.name,
      c.created_by,
      cp.last_read_at,
      (
        SELECT count(*)::int
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_id <> $1
          AND m.created_at > cp.last_read_at
      ) AS unread_count,
      other.id AS other_user_id,
      other.employee_code AS other_user_code,
      other.first_name || ' ' || other.last_name AS other_user_name,
      other.user_type AS other_user_type,
      other.job_title AS other_user_job_title,
      COALESCE(other.photo_url, '') AS other_user_photo,
      d.name AS other_user_department,
      u.role AS other_user_role
    FROM conversations c
    JOIN conversation_participants cp
      ON cp.conversation_id = c.id
     AND cp.employee_id = $1
    JOIN conversation_participants cp_other
      ON cp_other.conversation_id = c.id
     AND cp_other.employee_id <> $1
    JOIN employees other
      ON other.id = cp_other.employee_id
    LEFT JOIN users u
      ON u.employee_id = other.id
    LEFT JOIN departments d
      ON d.id = other.department_id
    WHERE c.id = $2
  `, [me, conversationId]);

  res.json(r.rows[0] || { id: conversationId });
}

export async function getConversationMessages(req: Request, res: Response) {
  const me = req.user!.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });

  const conversationId = Number(req.params.id);
  if (!conversationId) return res.status(400).json({ message: 'Invalid conversation ID' });

  // Verify participation
  const part = await query<any>(
    'SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND employee_id=$2',
    [conversationId, me]
  );
  if (!part.rows[0]) {
    return res.status(403).json({ message: 'You are not a participant in this conversation.' });
  }

  // Mark conversation as read
  await query(
    'UPDATE conversation_participants SET last_read_at=now() WHERE conversation_id=$1 AND employee_id=$2',
    [conversationId, me]
  );

  const r = await query<any>(`
    SELECT
      m.id,
      m.conversation_id,
      m.sender_id,
      m.message_text,
      m.created_at,
      e.employee_code AS sender_code,
      e.first_name || ' ' || e.last_name AS sender_name,
      (m.sender_id = $2) AS is_mine
    FROM messages m
    JOIN employees e ON e.id = m.sender_id
    WHERE m.conversation_id = $1
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT 300
  `, [conversationId, me]);

  res.json(r.rows);
}

export async function sendMessage(req: Request, res: Response) {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });

  const conversationId = Number(req.params.id);
  const messageText = String(req.body.messageText || req.body.content || '').trim();

  if (!conversationId) return res.status(400).json({ message: 'Invalid conversation ID' });
  if (!messageText) return res.status(400).json({ message: 'Message text cannot be empty' });
  if (messageText.length > 5000) return res.status(400).json({ message: 'Message is too long (max 5000 chars)' });

  // Verify participation
  const part = await query<any>(
    'SELECT 1 FROM conversation_participants WHERE conversation_id=$1 AND employee_id=$2',
    [conversationId, me]
  );
  if (!part.rows[0]) {
    return res.status(403).json({ message: 'You are not a participant in this conversation.' });
  }

  const r = await query<any>(`
    INSERT INTO messages(conversation_id, sender_id, message_text, created_at)
    VALUES($1, $2, $3, now())
    RETURNING id, conversation_id, sender_id, message_text, created_at
  `, [conversationId, me, messageText]);

  // Update conversation last message timestamp
  await query(`
    UPDATE conversations
    SET last_message_text = $1,
        last_message_at = now(),
        updated_at = now()
    WHERE id = $2
  `, [messageText.slice(0, 200), conversationId]);

  // Update sender read timestamp
  await query(`
    UPDATE conversation_participants
    SET last_read_at = now()
    WHERE conversation_id = $1 AND employee_id = $2
  `, [conversationId, me]);

  const senderInfo = await query<any>(
    `SELECT employee_code, first_name || ' ' || last_name AS sender_name FROM employees WHERE id=$1`,
    [me]
  );

  res.status(201).json({
    ...r.rows[0],
    sender_code: senderInfo.rows[0]?.employee_code,
    sender_name: senderInfo.rows[0]?.sender_name,
    is_mine: true
  });
}

export async function markConversationRead(req: Request, res: Response) {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });

  const conversationId = Number(req.params.id);
  if (!conversationId) return res.status(400).json({ message: 'Invalid conversation ID' });

  await query(`
    UPDATE conversation_participants
    SET last_read_at = now()
    WHERE conversation_id = $1 AND employee_id = $2
  `, [conversationId, me]);

  res.json({ ok: true });
}

export async function searchUsersForMessaging(req: Request, res: Response) {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });

  const senderRole = req.user?.role;
  const search = String(req.query.q || '').trim();

  // Fetch sender's team_lead_id and admin_id
  const meEmpRes = await query<any>(
    'SELECT id, team_lead_id, admin_id FROM employees WHERE id = $1',
    [me]
  );
  const meEmp = meEmpRes.rows[0];
  const myTeamLeadId = meEmp?.team_lead_id || null;
  const myAdminId = meEmp?.admin_id || null;

  const p: any[] = [me];
  let w = `WHERE e.status = 'ACTIVE' AND e.id <> $1`;

  if (senderRole === 'SUPER_ADMIN' || senderRole === 'ADMIN') {
    // Admin and Super Admin can message all employees across the organization
  } else if (senderRole === 'TEAM_LEAD') {
    // Team lead can message its team members, the admin assigned to it, and Super Admin
    p.push(me);
    const tlConds: string[] = [`e.team_lead_id = $${p.length}`];

    if (myAdminId) {
      p.push(myAdminId);
      tlConds.push(`e.id = $${p.length}`);
    }
    tlConds.push(`u.role = 'SUPER_ADMIN'`);

    w += ` AND (${tlConds.join(' OR ')})`;
  } else {
    // Members of a team (EMPLOYEE / INTERN)
    // Can message peers in the same team, their team lead, and Super Admin
    const empConds: string[] = [];
    if (myTeamLeadId) {
      p.push(myTeamLeadId);
      empConds.push(`e.team_lead_id = $${p.length}`);
      empConds.push(`e.id = $${p.length}`);
    }
    empConds.push(`u.role = 'SUPER_ADMIN'`);

    w += ` AND (${empConds.join(' OR ')})`;
  }

  if (search) {
    p.push(`%${search}%`);
    const sIdx = p.length;
    w += ` AND (e.first_name ILIKE $${sIdx} OR e.last_name ILIKE $${sIdx} OR e.employee_code ILIKE $${sIdx} OR e.email ILIKE $${sIdx} OR COALESCE(d.name,'') ILIKE $${sIdx} OR COALESCE(e.job_title,'') ILIKE $${sIdx})`;
  }

  const r = await query<any>(`
    SELECT
      e.id,
      e.employee_code,
      e.first_name,
      e.last_name,
      e.email,
      e.job_title,
      e.user_type,
      COALESCE(e.photo_url, '') AS photo_url,
      d.name AS department_name,
      u.role
    FROM employees e
    LEFT JOIN users u ON u.employee_id = e.id
    LEFT JOIN departments d ON d.id = e.department_id
    ${w}
    ORDER BY e.first_name ASC, e.last_name ASC
    LIMIT 50
  `, p);

  res.json(r.rows);
}

export async function createGroupConversation(req: Request, res: Response) {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });
  const name = String(req.body.name || req.body.groupName || '').trim();
  if (!name) return res.status(400).json({ message: 'Group name is required' });
  if (name.length > 255) return res.status(400).json({ message: 'Group name is too long (max 255 chars)' });

  const rawMemberIds: number[] = Array.isArray(req.body.memberIds)
    ? req.body.memberIds.map(Number).filter((id: number) => !isNaN(id) && id > 0)
    : [];

  const memberIds = Array.from(new Set([me, ...rawMemberIds]));

  if (memberIds.length < 2) {
    return res.status(400).json({ message: 'Please select at least 1 other team member for the group.' });
  }

  // Verify all members exist and are active
  const activeMembers = await query<any>(
    `SELECT id FROM employees WHERE id = ANY($1) AND status <> 'INACTIVE'`,
    [memberIds]
  );
  const validIds = activeMembers.rows.map((r) => Number(r.id));
  if (validIds.length < 2 || !validIds.includes(me)) {
    return res.status(400).json({ message: 'One or more selected members are invalid or inactive.' });
  }

  const convRes = await query<any>(
    `INSERT INTO conversations(is_group, name, created_by, created_at, updated_at)
     VALUES(true, $1, $2, now(), now())
     RETURNING id, is_group, name, created_by, created_at, updated_at`,
    [name, me]
  );
  const convId = Number(convRes.rows[0].id);

  for (const empId of validIds) {
    await query(
      `INSERT INTO conversation_participants(conversation_id, employee_id, last_read_at, created_at)
       VALUES($1, $2, now(), now())
       ON CONFLICT(conversation_id, employee_id) DO NOTHING`,
      [convId, empId]
    );
  }

  res.status(201).json({
    id: convId,
    is_group: true,
    group_name: name,
    name,
    group_created_by: me,
    member_count: validIds.length,
    unread_count: 0,
    created_at: convRes.rows[0].created_at,
    updated_at: convRes.rows[0].updated_at
  });
}

export async function getConversationMembers(req: Request, res: Response) {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });
  const conversationId = Number(req.params.id);
  if (!conversationId) return res.status(400).json({ message: 'Invalid conversation ID' });

  // Verify participant
  const part = await query<any>(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND employee_id = $2',
    [conversationId, me]
  );
  if (!part.rows[0]) {
    return res.status(403).json({ message: 'You are not a participant in this conversation.' });
  }

  const r = await query<any>(`
    SELECT
      e.id,
      e.employee_code,
      e.first_name,
      e.last_name,
      e.email,
      e.job_title,
      e.user_type,
      COALESCE(e.photo_url, '') AS photo_url,
      d.name AS department_name,
      u.role,
      cp.created_at AS joined_at,
      (c.created_by = e.id) AS is_creator
    FROM conversation_participants cp
    JOIN employees e ON e.id = cp.employee_id
    JOIN conversations c ON c.id = cp.conversation_id
    LEFT JOIN users u ON u.employee_id = e.id
    LEFT JOIN departments d ON d.id = e.department_id
    WHERE cp.conversation_id = $1
    ORDER BY (c.created_by = e.id) DESC, e.first_name ASC, e.last_name ASC
  `, [conversationId]);

  res.json(r.rows);
}

export async function addConversationMember(req: Request, res: Response) {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });
  const conversationId = Number(req.params.id);
  const employeeId = Number(req.body.employeeId || req.body.memberId);
  if (!conversationId || !employeeId) {
    return res.status(400).json({ message: 'Conversation ID and Employee ID required.' });
  }

  const conv = await query<any>(
    'SELECT id, is_group, created_by FROM conversations WHERE id = $1',
    [conversationId]
  );
  if (!conv.rows[0]) return res.status(404).json({ message: 'Conversation not found.' });
  if (!conv.rows[0].is_group) return res.status(400).json({ message: 'Cannot add members to a direct message.' });

  const part = await query<any>(
    'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND employee_id = $2',
    [conversationId, me]
  );
  if (!part.rows[0]) return res.status(403).json({ message: 'You are not a member of this group.' });

  await query(
    `INSERT INTO conversation_participants(conversation_id, employee_id, last_read_at, created_at)
     VALUES($1, $2, now(), now())
     ON CONFLICT(conversation_id, employee_id) DO NOTHING`,
    [conversationId, employeeId]
  );

  res.json({ ok: true, conversationId, employeeId });
}

export async function removeConversationMember(req: Request, res: Response) {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });
  const conversationId = Number(req.params.id);
  const memberId = Number(req.params.memberId);
  if (!conversationId || !memberId) {
    return res.status(400).json({ message: 'Conversation ID and Member ID required.' });
  }

  const conv = await query<any>(
    'SELECT id, is_group, created_by FROM conversations WHERE id = $1',
    [conversationId]
  );
  if (!conv.rows[0]) return res.status(404).json({ message: 'Conversation not found.' });
  if (!conv.rows[0].is_group) return res.status(400).json({ message: 'Cannot remove members from a direct message.' });

  const isCreator = conv.rows[0].created_by === me;
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(req.user?.role || '');
  const isSelf = memberId === me;

  if (!isCreator && !isAdmin && !isSelf) {
    return res.status(403).json({ message: 'You do not have permission to remove this member.' });
  }

  await query(
    'DELETE FROM conversation_participants WHERE conversation_id = $1 AND employee_id = $2',
    [conversationId, memberId]
  );

  res.json({ ok: true, conversationId, memberId });
}

export async function leaveGroupConversation(req: Request, res: Response) {
  const me = req.user?.employeeId;
  if (!me) return res.status(400).json({ message: 'Employee profile required' });
  const conversationId = Number(req.params.id);
  if (!conversationId) return res.status(400).json({ message: 'Invalid conversation ID' });

  await query(
    'DELETE FROM conversation_participants WHERE conversation_id = $1 AND employee_id = $2',
    [conversationId, me]
  );

  res.json({ ok: true, conversationId });
}

/* =========================================================
   NOTEPAD / PERSONAL NOTES SYSTEM
   ========================================================= */

export async function listNotes(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Authentication required' });

  const search = String(req.query.q || req.query.search || '').trim();
  let q = `SELECT id, user_id, title, content, created_at, updated_at FROM notes WHERE user_id = $1`;
  const p: any[] = [userId];

  if (search) {
    p.push(`%${search}%`);
    q += ` AND (title ILIKE $2 OR content ILIKE $2)`;
  }

  q += ` ORDER BY updated_at DESC, id DESC`;
  const r = await query<any>(q, p);
  res.json(r.rows);
}

export async function getNote(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Authentication required' });

  const noteId = Number(req.params.id);
  if (!noteId) return res.status(400).json({ message: 'Invalid note ID' });

  const r = await query<any>(
    'SELECT id, user_id, title, content, created_at, updated_at FROM notes WHERE id = $1 AND user_id = $2',
    [noteId, userId]
  );
  if (!r.rows[0]) return res.status(404).json({ message: 'Note not found' });
  res.json(r.rows[0]);
}

export async function createNote(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Authentication required' });

  const title = String(req.body.title || 'Untitled Note').trim().slice(0, 255) || 'Untitled Note';
  const content = String(req.body.content || '');

  const r = await query<any>(
    `INSERT INTO notes(user_id, title, content, created_at, updated_at)
     VALUES($1, $2, $3, now(), now())
     RETURNING id, user_id, title, content, created_at, updated_at`,
    [userId, title, content]
  );
  res.status(201).json(r.rows[0]);
}

export async function updateNote(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Authentication required' });

  const noteId = Number(req.params.id);
  if (!noteId) return res.status(400).json({ message: 'Invalid note ID' });

  const existing = await query<any>(
    'SELECT id FROM notes WHERE id = $1 AND user_id = $2',
    [noteId, userId]
  );
  if (!existing.rows[0]) return res.status(404).json({ message: 'Note not found' });

  const title = req.body.title !== undefined ? String(req.body.title).trim().slice(0, 255) : null;
  const content = req.body.content !== undefined ? String(req.body.content) : null;

  const r = await query<any>(
    `UPDATE notes
     SET title = COALESCE($1, title),
         content = COALESCE($2, content),
         updated_at = now()
     WHERE id = $3 AND user_id = $4
     RETURNING id, user_id, title, content, created_at, updated_at`,
    [title, content, noteId, userId]
  );
  res.json(r.rows[0]);
}

export async function deleteNote(req: Request, res: Response) {
  const userId = req.user?.userId;
  if (!userId) return res.status(401).json({ message: 'Authentication required' });

  const noteId = Number(req.params.id);
  if (!noteId) return res.status(400).json({ message: 'Invalid note ID' });

  const r = await query<any>(
    'DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id',
    [noteId, userId]
  );
  if (!r.rows[0]) return res.status(404).json({ message: 'Note not found' });
  res.json({ ok: true, id: noteId });
}



