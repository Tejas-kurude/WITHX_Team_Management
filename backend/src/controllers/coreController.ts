import { randomUUID } from 'crypto';
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

async function isTeamMember(teamLeadId: number | null, employeeId: number) {
  if (!teamLeadId) return false;
  const r = await query<any>('SELECT 1 FROM employees WHERE id=$1 AND team_lead_id=$2', [employeeId, teamLeadId]);
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
      AND t.status NOT IN ('COMPLETED','CANCELLED') ${scope}
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.employee_id=t.assigned_to AND n.type='TASK_DEADLINE' AND n.entity_type='TASK' AND n.entity_id=t.id::text
      )`, params);
  await query(`
    INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id)
    SELECT t.assigned_to,'TASK_OVERDUE','Task overdue',t.title || ' is overdue.','TASK',t.id::text
    FROM tasks t
    WHERE t.due_date IS NOT NULL AND t.due_date < now()
      AND t.status NOT IN ('COMPLETED','CANCELLED') ${scope}
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.employee_id=t.assigned_to AND n.type='TASK_OVERDUE' AND n.entity_type='TASK' AND n.entity_id=t.id::text
      )`, params);
}

export async function dashboard(req: Request, res: Response) {
  const role = req.user!.role, emp = req.user!.employeeId;
  if (role === 'EMPLOYEE') {
    const [task, att, rep, perf, leave] = await Promise.all([
      query<any>(`SELECT count(*)::int total,count(*) FILTER(WHERE status='COMPLETED')::int completed,count(*) FILTER(WHERE due_date<now() AND status NOT IN ('COMPLETED','CANCELLED'))::int overdue FROM tasks WHERE assigned_to=$1`, [emp]),
      query<any>(`SELECT status,attendance_mode,check_in,check_out FROM attendance WHERE employee_id=$1 AND work_date=current_date`, [emp]),
      query<any>(`SELECT count(*)::int submitted FROM daily_reports WHERE employee_id=$1 AND report_date>=date_trunc('month',current_date)`, [emp]),
      query<any>(`SELECT score,task_completion,on_time,attendance,working_hours FROM performance_scores WHERE employee_id=$1 ORDER BY period_end DESC LIMIT 1`, [emp]),
      query<any>(`SELECT count(*) FILTER(WHERE status='PENDING')::int pending FROM leave_requests WHERE employee_id=$1`, [emp])
    ]);
    return res.json({ scope: 'employee', tasks: task.rows[0], todayAttendance: att.rows[0] || null, reports: rep.rows[0], performance: perf.rows[0] || null, leave: leave.rows[0] });
  }
  const team = role === 'TEAM_LEAD';
  const params = team ? [emp] : [];
  const employeeWhere = team ? 'WHERE e.team_lead_id=$1' : 'WHERE 1=1';
  const joinTeam = team ? ' AND e.team_lead_id=$1' : '';
  const [employees, attendance, tasks, depts, activities] = await Promise.all([
    query<any>(`SELECT count(*)::int total,count(*) FILTER(WHERE e.status='ACTIVE')::int active,count(*) FILTER(WHERE e.user_type='INTERN')::int interns,count(*) FILTER(WHERE e.user_type='EMPLOYEE')::int employees FROM employees e ${employeeWhere}`, params),
    query<any>(`SELECT count(*) FILTER(WHERE a.status IN('PRESENT','LATE'))::int present,count(*) FILTER(WHERE a.status='LATE')::int late,count(*) FILTER(WHERE a.status='LEAVE')::int leave FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.work_date=current_date ${joinTeam}`, params),
    query<any>(`SELECT count(*)::int total,count(*) FILTER(WHERE t.status='COMPLETED')::int completed,count(*) FILTER(WHERE t.due_date<now() AND t.status NOT IN ('COMPLETED','CANCELLED'))::int overdue,count(*) FILTER(WHERE t.status='PENDING')::int pending FROM tasks t JOIN employees e ON e.id=t.assigned_to WHERE 1=1 ${joinTeam}`, params),
    team ? query<any>(`SELECT count(DISTINCT department_id)::int total FROM employees WHERE team_lead_id=$1 AND department_id IS NOT NULL`, [emp]) : query<any>('SELECT count(*)::int total FROM departments'),
    isAdmin(role) ? query<any>('SELECT al.id,al.action,al.entity_type,al.created_at,u.email FROM activity_logs al LEFT JOIN users u ON u.id=al.user_id ORDER BY al.created_at DESC LIMIT 8') : Promise.resolve({ rows: [] } as any)
  ]);
  res.json({ scope: role.toLowerCase(), employees: employees.rows[0], attendance: attendance.rows[0], tasks: tasks.rows[0], departments: depts.rows[0], recentActivity: activities.rows });
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
  if (req.user!.role === 'TEAM_LEAD') { p.push(req.user!.employeeId); where += ` AND e.team_lead_id=$${p.length}`; }
  if (search) { p.push(`%${search}%`); where += ` AND (e.first_name ILIKE $${p.length} OR e.last_name ILIKE $${p.length} OR e.employee_code ILIKE $${p.length} OR e.email ILIKE $${p.length})`; }
  if (department) { p.push(Number(department)); where += ` AND e.department_id=$${p.length}`; }
  if (status) { p.push(status); where += ` AND e.status=$${p.length}`; }
  if (userType) { p.push(userType); where += ` AND e.user_type=$${p.length}`; }
  if (role) { p.push(role); where += ` AND u.role=$${p.length}`; }
  if (teamLeadId && req.user!.role !== 'TEAM_LEAD') { p.push(Number(teamLeadId)); where += ` AND e.team_lead_id=$${p.length}`; }
  const r = await query<any>(`SELECT e.*,d.name department_name,tl.first_name||' '||tl.last_name team_lead_name,u.role FROM employees e LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees tl ON tl.id=e.team_lead_id LEFT JOIN users u ON u.employee_id=e.id ${where} ORDER BY e.created_at DESC`, p);
  res.json(r.rows);
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
  const { firstName, lastName, email, phone, jobTitle, departmentId, role = 'EMPLOYEE', joiningDate, password, teamLeadId, userType = 'EMPLOYEE' } = req.body;
  if (!firstName || !lastName || !email || !password) return res.status(400).json({ message: 'First name, last name, email and password are required' });
  if (!['INTERN', 'EMPLOYEE'].includes(userType)) return res.status(400).json({ message: 'User type must be INTERN or EMPLOYEE' });
  if (!['EMPLOYEE', 'TEAM_LEAD', 'ADMIN', 'SUPER_ADMIN'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
  if (req.user!.role === 'ADMIN' && ['ADMIN', 'SUPER_ADMIN'].includes(role)) return res.status(403).json({ message: 'Only Super Admin can create Admin or Super Admin accounts.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const code = await nextUserCode(client, userType);
    const e = await client.query<any>(`INSERT INTO employees(employee_code,user_type,first_name,last_name,email,phone,job_title,department_id,joining_date,team_lead_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [code, userType, firstName, lastName, email, textOrNull(phone), textOrNull(jobTitle), numOrNull(departmentId), joiningDate || new Date().toISOString().slice(0, 10), numOrNull(teamLeadId)]);
    const hash = await bcrypt.hash(password, 12);
    await client.query('INSERT INTO users(email,password_hash,role,employee_id) VALUES($1,$2,$3,$4)', [email, hash, role, e.rows[0].id]);
    await client.query('COMMIT');
    await audit(req.user?.userId, 'CREATE', userType, e.rows[0].id, { code, email, role, departmentId, teamLeadId });
    res.status(201).json(e.rows[0]);
  } catch (err: any) {
    await client.query('ROLLBACK');
    if (err?.code === '23505') return res.status(409).json({ message: 'An account with this email or generated ID already exists.' });
    throw err;
  } finally { client.release(); }
}
export async function updateEmployee(req: Request, res: Response) {
  const id = Number(req.params.id), b = req.body;
  const r = await query<any>(`UPDATE employees SET first_name=COALESCE($1,first_name),last_name=COALESCE($2,last_name),phone=$3,job_title=$4,department_id=$5,team_lead_id=$6,status=COALESCE($7,status),updated_at=now() WHERE id=$8 RETURNING *`, [b.firstName || null, b.lastName || null, textOrNull(b.phone), textOrNull(b.jobTitle), numOrNull(b.departmentId), numOrNull(b.teamLeadId), b.status || null, id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Employee not found' });
  await audit(req.user?.userId, 'UPDATE', 'EMPLOYEE', id, b);
  res.json(r.rows[0]);
}
export async function deleteEmployee(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (req.user?.employeeId === id) return res.status(400).json({ message: 'You cannot delete your own Super Admin account.' });
  const r = await query<any>('DELETE FROM employees WHERE id=$1 RETURNING id,email,employee_code', [id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Employee not found' });
  await audit(req.user?.userId, 'DELETE', 'EMPLOYEE', id, { email: r.rows[0].email, employeeCode: r.rows[0].employee_code });
  res.json({ ok: true });
}

export async function listTasks(req: Request, res: Response) {
  await syncDeadlineNotifications(req.user!.role === 'EMPLOYEE' ? req.user!.employeeId : null);
  const { search = '', status = '', priority = '', department = '', employeeId = '', teamLeadId = '', date = '' } = req.query as any;
  const p: any[] = []; let w = 'WHERE 1=1';
  if (req.user!.role === 'EMPLOYEE') { p.push(req.user!.employeeId); w += ` AND t.assigned_to=$${p.length}`; }
  else if (req.user!.role === 'TEAM_LEAD') { p.push(req.user!.employeeId); w += ` AND (t.assigned_to=$${p.length} OR e.team_lead_id=$${p.length})`; }
  if (search) { p.push(`%${search}%`); w += ` AND (t.title ILIKE $${p.length} OR t.description ILIKE $${p.length} OR e.first_name ILIKE $${p.length} OR e.last_name ILIKE $${p.length})`; }
  if (status) {
    if (status === 'OVERDUE') w += ` AND t.due_date<now() AND t.status NOT IN ('COMPLETED','CANCELLED')`;
    else { p.push(status); w += ` AND t.status=$${p.length}`; }
  }
  if (priority) { p.push(priority); w += ` AND t.priority=$${p.length}`; }
  if (department) { p.push(Number(department)); w += ` AND e.department_id=$${p.length}`; }
  if (employeeId) { p.push(Number(employeeId)); w += ` AND t.assigned_to=$${p.length}`; }
  if (teamLeadId) { p.push(Number(teamLeadId)); w += ` AND e.team_lead_id=$${p.length}`; }
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
    'COMPLETED',
    'CANCELLED'
  )
  THEN false

  /*
   * TEAM LEAD
   *
   * Team Lead can review while their own review
   * is still PENDING.
   */
  WHEN $${p.length + 1}::varchar = 'TEAM_LEAD'
   AND lead_review.decision = 'PENDING'
   AND e.team_lead_id = $${p.length + 2}::integer
  THEN true

  /*
   * ADMIN
   *
   * Admin can review independently.
   * Team Lead does NOT have to approve first.
   */
  WHEN $${p.length + 1}::varchar = 'ADMIN'
   AND admin_review.decision = 'PENDING'
  THEN true

  /*
   * SUPER ADMIN
   *
   * Super Admin can review independently.
   * Team Lead/Admin do NOT have to approve first.
   */
  WHEN $${p.length + 1}::varchar = 'SUPER_ADMIN'
   AND super_review.decision = 'PENDING'
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
      WHEN t.status IN ('REJECTED', 'NEEDS_CHANGES', 'COMPLETED', 'CANCELLED') THEN NULL
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
     WHEN t.due_date < now() AND t.status NOT IN ('COMPLETED', 'CANCELLED') THEN 'OVERDUE'
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

  ORDER BY
    t.created_at DESC
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
  const { title, description, assignmentType = 'INDIVIDUAL', assignedTo, assignedToIds, teamLeadId, departmentId, priority = 'MEDIUM', startDate, dueDate, attachmentUrl } = req.body;
  if (!title) return res.status(400).json({ message: 'Task title is required.' });
  const type = String(assignmentType).toUpperCase();
  if (!['INDIVIDUAL', 'MULTIPLE', 'TEAM', 'DEPARTMENT'].includes(type)) return res.status(400).json({ message: 'Invalid assignment type.' });
  let ids: number[] = [];
  let scopeRef: number | null = null;
  if (type === 'INDIVIDUAL') ids = [Number(assignedTo)].filter(Boolean);
  if (type === 'MULTIPLE') ids = (Array.isArray(assignedToIds) ? assignedToIds : String(assignedToIds || '').split(',')).map(Number).filter(Boolean);
  if (type === 'TEAM') {
    scopeRef = req.user!.role === 'TEAM_LEAD' ? req.user!.employeeId : Number(teamLeadId);
    if (!scopeRef) return res.status(400).json({ message: 'Select a team lead/team.' });
    const rr = await query<any>('SELECT id FROM employees WHERE team_lead_id=$1 AND status=\'ACTIVE\'', [scopeRef]); ids = rr.rows.map(x => x.id);
  }
  if (type === 'DEPARTMENT') {
    if (req.user!.role === 'TEAM_LEAD') return res.status(403).json({ message: 'Team Leads can assign only to their own team, not an entire department.' });
    scopeRef = Number(departmentId);
    if (!scopeRef) return res.status(400).json({ message: 'Select a department.' });
    const rr = await query<any>('SELECT id FROM employees WHERE department_id=$1 AND status=\'ACTIVE\'', [scopeRef]); ids = rr.rows.map(x => x.id);
  }
  ids = [...new Set(ids)];
  if (!ids.length) return res.status(400).json({ message: 'No eligible employee/intern was selected for this task.' });
  if (req.user!.role === 'TEAM_LEAD') {
    for (const id of ids) if (!(await isTeamMember(req.user!.employeeId, id))) return res.status(403).json({ message: 'Team Leads may assign tasks only to employees/interns under their supervision.' });
  }
  const batchId = randomUUID();
  const client = await pool.connect();
  const created: any[] = [];
  try {
    await client.query('BEGIN');
    for (const id of ids) {
      const r = await client.query<any>(`INSERT INTO tasks(assignment_batch_id,assignment_scope,scope_ref_id,title,description,assigned_to,created_by,priority,start_date,due_date,attachment_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [batchId, type, scopeRef, title, textOrNull(description), id, req.user!.employeeId, priority, startDate || null, dueDate || null, textOrNull(attachmentUrl)]);
      created.push(r.rows[0]);
      await client.query(`INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id) VALUES($1,'TASK_ASSIGNED','New task assigned',$2,'TASK',$3)`, [id, title, String(r.rows[0].id)]);
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  await audit(req.user?.userId, 'CREATE', 'TASK', batchId, { title, assignmentType: type, assignedCount: ids.length, assignedTo: ids });
  res.status(201).json({ batchId, assignedCount: ids.length, tasks: created });
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
  if (!hasProofUrl && !hasProofFile) {
    return res.status(400).json({ message: 'Add a proof link or upload a proof file.' });
  }

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

  /* Normalize proof evidence. A link may still use the existing
   * GitHub/Google Drive convention, while uploaded files are accepted
   * for either technical or non-technical work. */
  let normalizedProofType = String(proofType || (hasProofFile ? 'FILE' : '')).toUpperCase();
  if (hasProofUrl) {
    normalizedProofType = task.task_type === 'NON_TECHNICAL' ? 'GOOGLE_DRIVE' : 'GITHUB';
    let parsedUrl: URL;
    try { parsedUrl = new URL(proofUrl); }
    catch { return res.status(400).json({ message: 'Proof link must be a valid URL.' }); }
    const hostname = parsedUrl.hostname.toLowerCase();
    if (normalizedProofType === 'GITHUB' && hostname !== 'github.com' && !hostname.endsWith('.github.com')) {
      return res.status(400).json({ message: 'Technical proof links must use github.com, or upload a proof file instead.' });
    }
    if (normalizedProofType === 'GOOGLE_DRIVE' && hostname !== 'drive.google.com' && hostname !== 'docs.google.com') {
      return res.status(400).json({ message: 'Non-technical proof links must use Google Drive/Docs, or upload a proof file instead.' });
    }
  } else {
    normalizedProofType = 'FILE';
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
          proofUrl.trim()
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

  const submissionResult = await query<any>(
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

  if (!submissionResult.rows[0]) {
    return res.status(400).json({
      message:
        'No completion submission exists for this task.'
    });
  }

  const submission =
    submissionResult.rows[0];

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

   if (task.status !== 'SUBMITTED') {
     return res.status(400).json({
       message: `This task cannot currently be reviewed. Current status: ${task.status}.`
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
  const role = req.user!.role;
  const employeeId = req.user!.employeeId;

  /*
   * Keep the existing history access rules.
   */
  if (
    role === 'EMPLOYEE' &&
    task.assigned_to !== employeeId
  ) {
    return res.status(403).json({
      message: 'You can view history only for your own tasks.'
    });
  }

  if (
    role === 'TEAM_LEAD' &&
    task.team_lead_id !== employeeId
  ) {
    return res.status(403).json({
      message:
        'You can view history only for tasks under your supervision.'
    });
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
        NULL::integer AS submission_number
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
        NULL::integer AS submission_number
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
        )::integer AS submission_number
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
        NULL::integer AS submission_number
      FROM task_reviews tr
      LEFT JOIN employees reviewer
        ON reviewer.id = tr.reviewer_id
      WHERE tr.task_id = $1::integer
        AND tr.reviewed_at IS NOT NULL
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
  const assignedTo = numOrNull(b.assignedTo);
  const r = await query<any>(`UPDATE tasks SET title=COALESCE($1,title),description=$2,assigned_to=COALESCE($3,assigned_to),priority=COALESCE($4,priority),start_date=$5,due_date=$6,status=COALESCE($7,status),progress=COALESCE($8,progress),attachment_url=$9,completed_at=CASE WHEN COALESCE($7,status)='COMPLETED' THEN COALESCE(completed_at,now()) ELSE NULL END,updated_at=now() WHERE id=$10 RETURNING *`, [b.title || null, textOrNull(b.description), assignedTo, b.priority || null, b.startDate || null, b.dueDate || null, b.status || null, b.progress === '' || b.progress === undefined ? null : Number(b.progress), textOrNull(b.attachmentUrl), id]);
  if (!r.rows[0]) return res.status(404).json({ message: 'Task not found' });
  await query(`INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id) VALUES($1,'TASK_UPDATED','Task updated',$2,'TASK',$3)`, [r.rows[0].assigned_to, r.rows[0].title, String(id)]);
  await audit(req.user?.userId, 'UPDATE', 'TASK', id, b);
  res.json(r.rows[0]);
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
  const r = await query<any>('SELECT * FROM attendance WHERE employee_id=$1 AND work_date=current_date', [id]); res.json(r.rows[0] || null);
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
  const r = await query<any>(`INSERT INTO attendance(employee_id,work_date,status,attendance_mode,check_in,check_in_lat,check_in_lng,location_accuracy,location_verified,location_text) VALUES($1,current_date,$2,$3,now(),$4,$5,$6,$7,$8) ON CONFLICT(employee_id,work_date) DO UPDATE SET check_in=COALESCE(attendance.check_in,EXCLUDED.check_in),status=CASE WHEN attendance.status='LEAVE' THEN 'LEAVE' ELSE EXCLUDED.status END,attendance_mode=EXCLUDED.attendance_mode,check_in_lat=$4,check_in_lng=$5,location_accuracy=$6,location_verified=$7,location_text=$8 RETURNING *`, [emp, late ? 'LATE' : 'PRESENT', mode, mode === 'OFFLINE' ? latitude : null, mode === 'OFFLINE' ? longitude : null, mode === 'OFFLINE' ? accuracy || null : null, verified, locationText]);
  await audit(req.user?.userId, 'CHECK_IN', 'ATTENDANCE', r.rows[0].id, { mode, distance, locationVerified: verified });
  res.json(r.rows[0]);
}
export async function checkOut(req: Request, res: Response) {
  const emp = req.user!.employeeId;
  const cur = await query<any>('SELECT * FROM attendance WHERE employee_id=$1 AND work_date=current_date', [emp]);
  if (!cur.rows[0]?.check_in) return res.status(400).json({ message: 'Check in first.' });
  let lat = null, lng = null;
  if (cur.rows[0].attendance_mode === 'OFFLINE') {
    if (req.body.latitude == null || req.body.longitude == null) return res.status(400).json({ message: 'Location permission is required to check out from Offline attendance.' });
    lat = req.body.latitude; lng = req.body.longitude;
  }
  const r = await query<any>(`UPDATE attendance SET check_out=now(),check_out_lat=$1,check_out_lng=$2,total_hours=ROUND((EXTRACT(EPOCH FROM(now()-check_in))/3600)::numeric,2) WHERE id=$3 RETURNING *`, [lat, lng, cur.rows[0].id]);
  await audit(req.user?.userId, 'CHECK_OUT', 'ATTENDANCE', r.rows[0].id, { mode: cur.rows[0].attendance_mode }); res.json(r.rows[0]);
}
export async function listAttendance(req: Request, res: Response) {
  const { month = '', department = '', employeeId = '', mode = '', search = '' } = req.query as any;
  const p: any[] = []; let w = 'WHERE 1=1';
  if (req.user!.role === 'EMPLOYEE') { p.push(req.user!.employeeId); w += ` AND a.employee_id=$${p.length}`; }
  else if (req.user!.role === 'TEAM_LEAD') { p.push(req.user!.employeeId); w += ` AND e.team_lead_id=$${p.length}`; }
  if (month) { p.push(month + '-01'); w += ` AND a.work_date>=date_trunc('month',$${p.length}::date) AND a.work_date<(date_trunc('month',$${p.length}::date)+interval '1 month')`; }
  if (department) { p.push(Number(department)); w += ` AND e.department_id=$${p.length}`; }
  if (employeeId) { p.push(Number(employeeId)); w += ` AND e.id=$${p.length}`; }
  if (mode) { p.push(mode); w += ` AND a.attendance_mode=$${p.length}`; }
  if (search) { p.push(`%${search}%`); w += ` AND (e.first_name ILIKE $${p.length} OR e.last_name ILIKE $${p.length} OR e.employee_code ILIKE $${p.length} OR COALESCE(d.name,'') ILIKE $${p.length} OR a.attendance_mode ILIKE $${p.length} OR a.status ILIKE $${p.length})`; }
  const r = await query<any>(`SELECT a.*,e.employee_code,e.user_type,e.first_name||' '||e.last_name employee_name,u.id user_id,d.name department_name FROM attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN users u ON u.employee_id=e.id LEFT JOIN departments d ON d.id=e.department_id ${w} ORDER BY a.work_date DESC,a.check_in DESC LIMIT 500`, p); res.json(r.rows);
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
  const { type, startDate, endDate, reason } = req.body; if (!type || !startDate || !endDate || !reason) return res.status(400).json({ message: 'All fields are required' });
  if (String(endDate) < String(startDate)) return res.status(400).json({ message: 'To Date cannot be earlier than From Date.' });
  const r = await query<any>('INSERT INTO leave_requests(employee_id,leave_type,start_date,end_date,reason) VALUES($1,$2,$3,$4,$5) RETURNING *', [req.user!.employeeId, type, startDate, endDate, reason]); await audit(req.user?.userId, 'APPLY', 'LEAVE', r.rows[0].id); res.status(201).json(r.rows[0]);
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
  const id = Number(req.params.id), { status, comment } = req.body; if (!['APPROVED', 'REJECTED'].includes(status)) return res.status(400).json({ message: 'Status must be APPROVED or REJECTED' });
  const target = await query<any>('SELECT * FROM leave_requests WHERE id=$1', [id]); if (!target.rows[0]) return res.status(404).json({ message: 'Leave request not found' });
  if (req.user!.role === 'TEAM_LEAD') return res.status(403).json({ message: 'Team Leads do not have leave approval permission.' });
  if (req.user!.role === 'ADMIN' && target.rows[0].employee_id === req.user!.employeeId) return res.status(403).json({ message: 'Admin cannot approve or reject their own leave. Super Admin approval is required.' });
  const r = await query<any>('UPDATE leave_requests SET status=$1,review_comment=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4 RETURNING *', [status, textOrNull(comment), req.user!.employeeId, id]);
  if (status === 'APPROVED') await query(`INSERT INTO attendance(employee_id,work_date,status,attendance_mode,location_text) SELECT $1,d::date,'LEAVE','OFFLINE','Approved leave' FROM generate_series($2::date,$3::date,'1 day') d ON CONFLICT(employee_id,work_date) DO UPDATE SET status='LEAVE'`, [r.rows[0].employee_id, r.rows[0].start_date, r.rows[0].end_date]);
  await query(`INSERT INTO notifications(employee_id,type,title,message,entity_type,entity_id) VALUES($1,$2,$3,$4,'LEAVE',$5)`, [r.rows[0].employee_id, 'LEAVE_' + status, 'Leave request ' + status.toLowerCase(), comment || `Your leave request was ${status.toLowerCase()}.`, String(id)]);
  await audit(req.user?.userId, status, 'LEAVE', id); res.json(r.rows[0]);
}
export async function updateLeaveRequest(req: Request, res: Response) { const id = Number(req.params.id); const { type, startDate, endDate, reason } = req.body; const r = await query<any>('UPDATE leave_requests SET leave_type=COALESCE($1,leave_type),start_date=COALESCE($2::date,start_date),end_date=COALESCE($3::date,end_date),reason=COALESCE($4,reason) WHERE id=$5 RETURNING *', [type || null, startDate || null, endDate || null, reason || null, id]); if (!r.rows[0]) return res.status(404).json({ message: 'Leave request not found' }); await audit(req.user?.userId, 'UPDATE', 'LEAVE', id, req.body); res.json(r.rows[0]); }
export async function deleteLeave(req: Request, res: Response) { const id = Number(req.params.id); const r = await query<any>('DELETE FROM leave_requests WHERE id=$1 RETURNING id', [id]); if (!r.rows[0]) return res.status(404).json({ message: 'Leave request not found' }); await audit(req.user?.userId, 'DELETE', 'LEAVE', id); res.json({ ok: true }); }

export async function performance(req: Request, res: Response) {
  let target = Number(req.query.employeeId || req.user!.employeeId);
  if (req.user!.role === 'EMPLOYEE') target = req.user!.employeeId!;
  if (!target) return res.status(400).json({ message: 'employeeId required' });
  if (req.user!.role === 'TEAM_LEAD' && !(await requireTeamAuthority(req, target))) return res.status(403).json({ message: 'This employee is outside your team.' });

  const setting = await query<any>(`SELECT value FROM system_settings WHERE key='minimum_work_minutes'`);
  const minimumWorkMinutes = Math.max(1, Number(setting.rows[0]?.value || 180));
  const minimumWorkHours = minimumWorkMinutes / 60;

  const { rows } = await query<any>(`
    WITH task AS (
      SELECT count(*) task_total,
             count(*) FILTER(WHERE status='COMPLETED') task_completed,
             count(*) FILTER(WHERE status='COMPLETED' AND (due_date IS NULL OR completed_at<=due_date)) task_ontime
      FROM tasks WHERE assigned_to=$1
    ), att AS (
      SELECT count(*) attendance_total,
             count(*) FILTER(WHERE status IN('PRESENT','LATE')) attended,
             avg(LEAST(COALESCE(total_hours,0) / $2::numeric, 1.0))
               FILTER(WHERE status IN('PRESENT','LATE') AND check_in IS NOT NULL AND check_out IS NOT NULL) work_ratio
      FROM attendance
      WHERE employee_id=$1 AND work_date>=current_date-interval '30 days'
    )
    SELECT * FROM task,att`, [target, minimumWorkHours]);

  const x = rows[0];
  const taskCompletion = x.task_total ? Number(x.task_completed) / Number(x.task_total) * 100 : 100;
  const onTime = x.task_completed ? Number(x.task_ontime) / Number(x.task_completed) * 100 : 100;
  const attendance = x.attendance_total ? Number(x.attended) / Number(x.attendance_total) * 100 : 100;
  const workingHours = Math.max(0, Math.min(100, Number(x.work_ratio || 0) * 100));
  const score = .35 * taskCompletion + .25 * onTime + .20 * attendance + .20 * workingHours;
  const start = new Date(); start.setDate(start.getDate() - 30);

  const r = await query<any>(`
    INSERT INTO performance_scores(employee_id,period_start,period_end,task_completion,on_time,attendance,punctuality,report_consistency,working_hours,score)
    VALUES($1,$2,current_date,$3,$4,$5,0,0,$6,$7) RETURNING *`,
    [target, start.toISOString().slice(0, 10), taskCompletion, onTime, attendance, workingHours, score]);
  res.json(r.rows[0]);
}
export async function performanceList(req: Request, res: Response) { const p: any[] = []; let w = 'WHERE 1=1'; if (req.user!.role === 'EMPLOYEE') { p.push(req.user!.employeeId); w += ` AND p.employee_id=$${p.length}`; } else if (req.user!.role === 'TEAM_LEAD') { p.push(req.user!.employeeId); w += ` AND e.team_lead_id=$${p.length}`; } const r = await query<any>(`SELECT DISTINCT ON(p.employee_id) p.*,e.employee_code,e.user_type,e.first_name||' '||e.last_name employee_name,d.name department_name FROM performance_scores p JOIN employees e ON e.id=p.employee_id LEFT JOIN departments d ON d.id=e.department_id ${w} ORDER BY p.employee_id,p.period_end DESC`, p); res.json(r.rows); }

export async function notifications(req: Request, res: Response) {
  await syncDeadlineNotifications(req.user!.role === 'SUPER_ADMIN' ? null : req.user!.employeeId);
  if (req.user!.role === 'SUPER_ADMIN') { const r = await query<any>(`SELECT n.*,e.employee_code,e.first_name||' '||e.last_name employee_name FROM notifications n JOIN employees e ON e.id=n.employee_id ORDER BY n.created_at DESC LIMIT 300`); return res.json(r.rows); }
  const r = await query<any>('SELECT * FROM notifications WHERE employee_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user!.employeeId]); res.json(r.rows);
}
export async function markNotification(req: Request, res: Response) { await query('UPDATE notifications SET is_read=true,read_at=now() WHERE id=$1 AND employee_id=$2', [Number(req.params.id), req.user!.employeeId]); res.json({ ok: true }); }
export async function updateNotification(req: Request, res: Response) { const id = Number(req.params.id), { title, message } = req.body; const r = await query<any>('UPDATE notifications SET title=COALESCE($1,title),message=COALESCE($2,message) WHERE id=$3 RETURNING *', [title || null, message || null, id]); if (!r.rows[0]) return res.status(404).json({ message: 'Notification not found' }); await audit(req.user?.userId, 'UPDATE', 'NOTIFICATION', id); res.json(r.rows[0]); }
export async function deleteNotification(req: Request, res: Response) { const id = Number(req.params.id); const r = await query<any>('DELETE FROM notifications WHERE id=$1 RETURNING id', [id]); if (!r.rows[0]) return res.status(404).json({ message: 'Notification not found' }); await audit(req.user?.userId, 'DELETE', 'NOTIFICATION', id); res.json({ ok: true }); }

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
  const allowed = ['company_name', 'office_address', 'office_latitude', 'office_longitude', 'geofence_radius_m', 'work_start_time', 'late_after_time', 'minimum_work_minutes'];
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
    team ? query<any>(`SELECT e.first_name||' '||e.last_name employee_name,p.score FROM performance_scores p JOIN employees e ON e.id=p.employee_id WHERE e.team_lead_id=$1 AND p.id IN(SELECT DISTINCT ON(employee_id) id FROM performance_scores ORDER BY employee_id,period_end DESC) ORDER BY p.score DESC LIMIT 10`, [emp]) : query<any>(`SELECT e.first_name||' '||e.last_name employee_name,p.score FROM performance_scores p JOIN employees e ON e.id=p.employee_id WHERE p.id IN(SELECT DISTINCT ON(employee_id) id FROM performance_scores ORDER BY employee_id,period_end DESC) ORDER BY p.score DESC LIMIT 10`)
  ]); res.json({ departments: dept.rows, tasks: task.rows, attendance: attendance.rows, performance: performance.rows });
}

export async function exportCsv(req: Request, res: Response) {
  const kind = String(req.params.kind); const team = req.user!.role === 'TEAM_LEAD'; const emp = req.user!.employeeId; let rows: any[] = [];
  if (kind === 'employees') rows = (await query<any>(`SELECT e.employee_code,e.user_type,e.first_name,e.last_name,e.email,e.phone,e.job_title,d.name department,e.joining_date,e.status FROM employees e LEFT JOIN departments d ON d.id=e.department_id ${team ? 'WHERE e.team_lead_id=$1' : ''} ORDER BY e.employee_code`, team ? [emp] : [])).rows;
  else if (kind === 'attendance') rows = (await query<any>(`SELECT a.work_date,e.employee_code,e.user_type,e.first_name||' '||e.last_name employee,d.name department,a.status,a.attendance_mode,a.check_in,a.check_out,a.total_hours,a.location_text,a.location_verified FROM attendance a JOIN employees e ON e.id=a.employee_id LEFT JOIN departments d ON d.id=e.department_id ${team ? 'WHERE e.team_lead_id=$1' : ''} ORDER BY a.work_date DESC`, team ? [emp] : [])).rows;
  else if (kind === 'tasks') rows = (await query<any>(`SELECT t.id,t.title,e.employee_code,e.user_type,e.first_name||' '||e.last_name assignee,d.name department,t.assignment_scope,t.priority,CASE WHEN t.due_date<now() AND t.status NOT IN('COMPLETED','CANCELLED') THEN 'OVERDUE' ELSE t.status END status,t.progress,t.start_date,t.due_date,t.completed_at,c.first_name||' '||c.last_name uploaded_by FROM tasks t JOIN employees e ON e.id=t.assigned_to LEFT JOIN departments d ON d.id=e.department_id LEFT JOIN employees c ON c.id=t.created_by ${team ? 'WHERE e.team_lead_id=$1' : ''} ORDER BY t.created_at DESC`, team ? [emp] : [])).rows;
  else if (kind === 'performance') rows = (await query<any>(`SELECT e.employee_code,e.user_type,e.first_name||' '||e.last_name employee,p.period_start,p.period_end,p.task_completion,p.on_time,p.attendance,p.working_hours,p.score FROM performance_scores p JOIN employees e ON e.id=p.employee_id ${team ? 'WHERE e.team_lead_id=$1' : ''} ORDER BY p.period_end DESC`, team ? [emp] : [])).rows;
  else return res.status(400).json({ message: 'Unknown export type' });
  const escape = (v: any) => `"${String(v ?? '').replaceAll('"', '""')}"`; const headers = rows[0] ? Object.keys(rows[0]) : []; const csv = [headers.map(escape).join(','), ...rows.map(row => headers.map(h => escape(row[h])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename=withx-${kind}.csv`); res.send(csv);
}
