import { FormEvent, useEffect, useState } from 'react';
<<<<<<< HEAD
=======
import { Eye, EyeOff } from 'lucide-react';
>>>>>>> 4410d4c (Update notifications and employee password management and delete popup UI)
import { api, messageOf } from '../services/api';
import { Empty, Modal, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

export default function Employees() {
  const { user } = useAuth();

  const isSuper = user?.role === 'SUPER_ADMIN';
  const canCreate =
    user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [rows, setRows] = useState<any[]>([]);
  const [deps, setDeps] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const [deleteUser, setDeleteUser] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
<<<<<<< HEAD
=======
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});
>>>>>>> 4410d4c (Update notifications and employee password management and delete popup UI)

  const [err, setErr] = useState('');
  const [pageErr, setPageErr] = useState('');

  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [userType, setUserType] = useState('');

  async function load() {
    try {
      setPageErr('');

      const r = await api.get('/employees', {
        params: {
          search: q,
          department,
          userType
        }
      });

      setRows(r.data);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  useEffect(() => {
    void load();

    void api
      .get('/departments')
      .then(r => setDeps(r.data))
      .catch(e => setPageErr(messageOf(e)));
  }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setErr('');

    const body = Object.fromEntries(
      new FormData(e.currentTarget).entries()
    );

    try {
      if (editing) {
        await api.put(`/employees/${editing.id}`, body);
      } else {
        await api.post('/employees', body);
      }

      setShow(false);
      setEditing(null);

      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  async function remove() {
    if (!deleteUser) return;

    try {
      setDeleting(true);
      setPageErr('');

      await api.delete(`/employees/${deleteUser.id}`);

      setDeleteUser(null);

      await load();
    } catch (e) {
      setPageErr(messageOf(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageTitle
        title={
          user?.role === 'TEAM_LEAD'
            ? 'My Team'
            : 'Employee & Intern Management'
        }
        subtitle={
          user?.role === 'TEAM_LEAD'
            ? 'Only employees/interns assigned to you are shown'
            : 'System-generated INT/EMP IDs, department and team assignment'
        }
        action={
          canCreate ? (
            <button
              className="btn btn-accent"
              onClick={() => {
                setEditing(null);
                setShow(true);
              }}
            >
              + Add User
            </button>
          ) : undefined
        }
      />

      {/* Search / Filters */}
      <div className="card mb-5 grid gap-3 p-4 md:grid-cols-4">

        <input
          className="input md:col-span-2"
          placeholder="Search ID, name or email"
          value={q}
          onChange={e => setQ(e.target.value)}
        />

        <select
          className="input"
          value={department}
          onChange={e => setDepartment(e.target.value)}
        >
          <option value="">All departments</option>

          {deps.map(d => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        <select
          className="input"
          value={userType}
          onChange={e => setUserType(e.target.value)}
        >
          <option value="">Employees + Interns</option>
          <option value="EMPLOYEE">Employees</option>
          <option value="INTERN">Interns</option>
        </select>

        <button
          className="btn btn-primary md:col-span-4"
          onClick={() => void load()}
        >
          Apply Search / Filters
        </button>
      </div>

      {/* Page Error */}
      {pageErr && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {pageErr}
        </div>
      )}

      {/* Employees Table */}
      {rows.length ? (
        <div className="table-wrap">

          <table className="table">

            <thead>
              <tr>
                <th>ID</th>
                <th>User</th>
                <th>Type</th>
                <th>Department</th>
                <th>Team Lead</th>
                <th>Role</th>
                <th>Status</th>

                {isSuper && <th>Manage</th>}
              </tr>
            </thead>

            <tbody>

              {rows.map(r => (
                <tr key={r.id}>

                  <td>
                    <b>{r.employee_code}</b>
                  </td>

                  <td>
                    <b>
                      {r.first_name} {r.last_name}
                    </b>

                    <div className="text-xs muted">
                      {r.email}
                    </div>
<<<<<<< HEAD
=======

                    {isSuper && (
                      <div className="mt-1 flex items-center gap-1 text-xs">
                        <span className="muted">Password:</span>
                        <span className="font-mono">
                          {visiblePasswords[r.id]
                            ? r.login_password || 'Not available'
                            : '••••••••'}
                        </span>
                        <button
                          type="button"
                          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          title={
                            visiblePasswords[r.id]
                              ? 'Hide password'
                              : 'Show password'
                          }
                          onClick={() =>
                            setVisiblePasswords(v => ({
                              ...v,
                              [r.id]: !v[r.id],
                            }))
                          }
                        >
                          {visiblePasswords[r.id] ? (
                            <EyeOff size={14} />
                          ) : (
                            <Eye size={14} />
                          )}
                        </button>
                      </div>
                    )}
>>>>>>> 4410d4c (Update notifications and employee password management and delete popup UI)
                  </td>

                  <td>
                    <span className="badge">
                      {r.user_type}
                    </span>
                  </td>

                  <td>
                    {r.department_name || '—'}
                  </td>

                  <td>
                    {r.team_lead_name || '—'}
                  </td>

                  <td>
                    {r.role?.replace(/_/g, ' ') || '—'}
                  </td>

                  <td>
                    <span className="badge">
                      {r.status}
                    </span>
                  </td>

                  {isSuper && (
                    <td>
                      <div className="flex gap-2">

                        <button
                          className="btn !px-3 !py-1.5"
                          onClick={() => {
                            setEditing(r);
                            setShow(true);
                          }}
                        >
                          Edit
                        </button>

                        <button
                          className="btn !px-3 !py-1.5 text-red-600"
                          disabled={r.id === user?.employeeId}
                          onClick={() => setDeleteUser(r)}
                        >
                          Delete
                        </button>

                      </div>
                    </td>
                  )}

                </tr>
              ))}

            </tbody>

          </table>
        </div>
      ) : (
        !pageErr && <Empty />
      )}

      {/* Create / Edit Modal */}
      {show && (
        <Modal
          title={
            editing
              ? 'Edit User'
              : 'Create Employee / Intern Account'
          }
          onClose={() => {
            setShow(false);
            setEditing(null);
            setErr('');
          }}
        >

          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={save}
          >

            {!editing && (
              <div className="sm:col-span-2 rounded-lg bg-slate-50 p-3 text-sm muted">
                The ID is generated automatically and never reused:
                INT001... for interns, EMP001... for employees.
              </div>
            )}

            <div>
              <label className="label">
                First Name
              </label>

              <input
                className="input mt-1"
                name="firstName"
                defaultValue={editing?.first_name || ''}
                required
              />
            </div>

            <div>
              <label className="label">
                Last Name
              </label>

              <input
                className="input mt-1"
                name="lastName"
                defaultValue={editing?.last_name || ''}
                required
              />
            </div>

            {!editing && (
              <>

                <div>
                  <label className="label">
                    User Type
                  </label>

                  <select
                    className="input mt-1"
                    name="userType"
                  >
                    <option value="EMPLOYEE">
                      Employee
                    </option>

                    <option value="INTERN">
                      Intern
                    </option>
                  </select>
                </div>

                <div>
                  <label className="label">
                    Email / Login ID
                  </label>

                  <input
                    className="input mt-1"
                    name="email"
                    type="email"
                    required
                  />
                </div>

                <div>
                  <label className="label">
                    Temporary Password
                  </label>

                  <input
                    className="input mt-1"
                    name="password"
                    type="password"
                    minLength={8}
                    required
                  />
                </div>

                <div>
                  <label className="label">
                    Role
                  </label>

                  <select
                    className="input mt-1"
                    name="role"
                  >
                    <option>EMPLOYEE</option>
                    <option>TEAM_LEAD</option>

                    {isSuper && (
                      <>
                        <option>ADMIN</option>
                        <option>SUPER_ADMIN</option>
                      </>
                    )}
                  </select>
                </div>

              </>
            )}

            <div>
              <label className="label">
                Phone
              </label>

              <input
                className="input mt-1"
                name="phone"
                defaultValue={editing?.phone || ''}
              />
            </div>

            <div>
              <label className="label">
                Job Title
              </label>

              <input
                className="input mt-1"
                name="jobTitle"
                defaultValue={editing?.job_title || ''}
              />
            </div>

            <div>
              <label className="label">
                Department
              </label>

              <select
                className="input mt-1"
                name="departmentId"
                defaultValue={editing?.department_id || ''}
              >

                <option value="">
                  Select department
                </option>

                {deps.map(d => (
                  <option
                    key={d.id}
                    value={d.id}
                  >
                    {d.name}
                  </option>
                ))}

              </select>
            </div>

            <div>
              <label className="label">
                Team Lead
              </label>

              <select
                className="input mt-1"
                name="teamLeadId"
                defaultValue={editing?.team_lead_id || ''}
              >

                <option value="">
                  None / not assigned
                </option>

                {rows
                  .filter(x => x.role === 'TEAM_LEAD')
                  .map(x => (
                    <option
                      key={x.id}
                      value={x.id}
                    >
                      {x.first_name} {x.last_name}
                    </option>
                  ))}

              </select>
            </div>

            {editing ? (
              <>
                <div>
                  <label className="label">
                    Status
                  </label>

                  <select
                    className="input mt-1"
                    name="status"
                    defaultValue={editing.status}
                  >
                    <option>ACTIVE</option>
                    <option>INACTIVE</option>
                  </select>
                </div>

                {isSuper && (
                  <div>
                    <label className="label">
                      New Password
                    </label>

                    <input
                      className="input mt-1"
                      name="password"
                      type="password"
                      minLength={8}
                      placeholder="Leave blank to keep current password"
                    />
                  </div>
                )}
              </>
            ) : (
              <div>
                <label className="label">
                  Joining Date
                </label>

                <input
                  className="input mt-1"
                  type="date"
                  name="joiningDate"
                />

              </div>
            )}

            {err && (
              <div className="sm:col-span-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {err}
              </div>
            )}

            <div className="sm:col-span-2 flex justify-end gap-2">

              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShow(false);
                  setEditing(null);
                  setErr('');
                }}
              >
                Cancel
              </button>

              <button className="btn btn-primary">
                {editing
                  ? 'Save Changes'
                  : 'Create Account'}
              </button>

            </div>

          </form>

        </Modal>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteUser && (
        <Modal
          title="Delete Employee?"
          onClose={() => {
            if (!deleting) {
              setDeleteUser(null);
            }
          }}
        >

          <div className="space-y-5">

            {/* Warning */}
            <div className="rounded-xl border border-red-200 bg-red-50 p-4">

              <div className="flex items-start gap-3">

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-xl">
                  ⚠️
                </div>

                <div>

                  <h3 className="font-semibold text-red-800">
                    Are you sure you want to delete this user?
                  </h3>

                  <p className="mt-1 text-sm text-red-700">
                    This action cannot be undone.
                  </p>

                </div>

              </div>

            </div>

            {/* User Info */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">

              <div className="font-semibold text-slate-900">
                {deleteUser.first_name}{' '}
                {deleteUser.last_name}
              </div>

              <div className="mt-1 text-sm muted">
                {deleteUser.employee_code}
                {' • '}
                {deleteUser.email}
              </div>

              <div className="mt-2 text-sm">

                {deleteUser.department_name ||
                  'No Department'}

                {' • '}

                {deleteUser.role?.replace(/_/g, ' ') ||
                  'No Role'}

              </div>

            </div>

            {/* Message */}
            <p className="text-sm muted">

              Related records may also be deleted.

              {' '}

              The employee/intern ID

              <b>
                {' '}
                {deleteUser.employee_code}
              </b>

              {' '}

              will not be reused.

            </p>

            {/* Buttons */}
            <div className="flex justify-end gap-3">

              <button
                type="button"
                className="btn"
                disabled={deleting}
                onClick={() =>
                  setDeleteUser(null)
                }
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn bg-red-600 text-white hover:bg-red-700"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {deleting
                  ? 'Deleting...'
                  : 'Delete User'}
              </button>

            </div>

          </div>

        </Modal>
      )}

    </>
  );
}
