import { FormEvent, useEffect, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, Modal, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { useSearchParams } from 'react-router-dom';

const API_ORIGIN = String(
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
).replace(/\/api\/?$/, '');

function employeePhotoUrl(value: string | null | undefined) {
  if (!value) return '';

  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:')
  ) {
    return value;
  }

  return `${API_ORIGIN}${value.startsWith('/') ? value : `/${value}`}`;
}

export default function Employees() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const isSuper = user?.role === 'SUPER_ADMIN';
  const canCreate =
    user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  const [rows, setRows] = useState<any[]>([]);
  const [deps, setDeps] = useState<any[]>([]);
  const [admins, setAdmins] = useState<any[]>([]);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});
  const [selectedRole, setSelectedRole] = useState('EMPLOYEE');
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<any | null>(null);

  const [photoPreview, setPhotoPreview] = useState('');
  const [photoFileData, setPhotoFileData] = useState('');
  const [photoFileName, setPhotoFileName] = useState('');
  const [fullImageUrl, setFullImageUrl] = useState('');

  const [deleteUser, setDeleteUser] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [err, setErr] = useState('');
  const [pageErr, setPageErr] = useState('');

  const [q, setQ] = useState(() => searchParams.get('search') || '');
  const [department, setDepartment] = useState(() => searchParams.get('department') || '');
  const [userType, setUserType] = useState(() => searchParams.get('userType') || '');

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

    void api
      .get('/employees', { params: { role: 'ADMIN', status: 'ACTIVE' } })
      .then(r => setAdmins(Array.isArray(r.data) ? r.data : []))
      .catch(e => setPageErr(messageOf(e)));
  }, []);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setErr('');

    const body: any = Object.fromEntries(
      new FormData(e.currentTarget).entries()
    );

    // File input itself is not sent. We send a validated base64 payload instead.
    delete body.profilePhoto;

    if (photoFileData && photoFileName) {
      body.photoFileData = photoFileData;
      body.photoFileName = photoFileName;
    }

    try {
      if (editing) {
        await api.put(`/employees/${editing.id}`, body);
      } else {
        await api.post('/employees', body);
      }

      setShow(false);
      setEditing(null);
      setPhotoPreview('');
      setPhotoFileData('');
      setPhotoFileName('');

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
                setSelectedRole('EMPLOYEE');
                setPhotoPreview('');
                setPhotoFileData('');
                setPhotoFileName('');
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
                <th>Admin</th>
                <th>Role</th>
                <th>Status</th>

                {isSuper && <th>Manage</th>}
              </tr>
            </thead>

            <tbody>

              {rows.map(r => (
                <tr
                  key={r.id}
                  onClick={() => setSelectedEmployee(r)}
                  className="cursor-pointer transition hover:bg-slate-50"
                >

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

                    {isSuper && (
                      <div className="mt-1 flex items-center gap-2 text-xs muted">
                        <span>
                          Password: {visiblePasswords[r.id] ? (r.login_password || '—') : '••••••••'}
                        </span>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center rounded p-1 hover:bg-slate-100"
                          onClick={e => {
                            e.stopPropagation();
                            setVisiblePasswords(prev => ({
                              ...prev,
                              [r.id]: !prev[r.id],
                            }));
                          }}
                          aria-label={visiblePasswords[r.id] ? 'Hide password' : 'Show password'}
                          title={visiblePasswords[r.id] ? 'Hide password' : 'Show password'}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="h-4 w-4"
                          >
                            {visiblePasswords[r.id] ? (
                              <>
                                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                                <circle cx="12" cy="12" r="3" />
                              </>
                            ) : (
                              <>
                                <path d="M3 3l18 18" />
                                <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                                <path d="M9.9 4.3A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a19.2 19.2 0 0 1-3.1 4.1" />
                                <path d="M6.1 6.1C3.4 8.1 2 12 2 12s3.5 8 10 8a10.7 10.7 0 0 0 4.1-.8" />
                              </>
                            )}
                          </svg>
                        </button>
                      </div>
                    )}
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
                    {r.admin_name || '—'}
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
                          onClick={e => {
                            e.stopPropagation();
                            setEditing(r);
                            setSelectedRole(r.role || 'EMPLOYEE');
                            setPhotoPreview(employeePhotoUrl(r.photo_url));
                            setPhotoFileData('');
                            setPhotoFileName('');
                            setShow(true);
                          }}
                        >
                          Edit
                        </button>

                        <button
                          className="btn !px-3 !py-1.5 text-red-600"
                          disabled={r.id === user?.employeeId}
                          onClick={e => {
                            e.stopPropagation();
                            setDeleteUser(r);
                          }}
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
            setSelectedRole('EMPLOYEE');
            setPhotoPreview('');
            setPhotoFileData('');
            setPhotoFileName('');
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
                    value={selectedRole}
                    onChange={e => setSelectedRole(e.target.value)}
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
                Email / Login ID
              </label>

              <input
                className="input mt-1"
                name="email"
                type="email"
                defaultValue={editing?.email || ''}
                required
              />
            </div>

            {editing && (
              <div>
                <label className="label">
                  Role
                </label>

                <select
                  className="input mt-1"
                  name="role"
                  value={selectedRole}
                  onChange={e => setSelectedRole(e.target.value)}
                >
                  <option value="EMPLOYEE">EMPLOYEE</option>
                  <option value="TEAM_LEAD">TEAM_LEAD</option>

                  {isSuper && (
                    <>
                      <option value="ADMIN">ADMIN</option>
                      <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                    </>
                  )}
                </select>
              </div>
            )}

            {editing && isSuper && (
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

            <div className="sm:col-span-2">
              <label className="label">
                Profile Photo
              </label>

              <div className="mt-2 flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">

                {(photoPreview || editing?.photo_url) ? (
                  <img
                    src={
                      photoPreview ||
                      employeePhotoUrl(editing?.photo_url)
                    }
                    alt="Profile preview"
                    className="h-24 w-24 shrink-0 rounded-full border-4 border-white object-cover shadow-sm"
                  />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-white text-2xl font-extrabold text-slate-500 shadow-sm">
                    {editing?.first_name?.charAt(0)?.toUpperCase() || '?'}
                    {editing?.last_name?.charAt(0)?.toUpperCase() || ''}
                  </div>
                )}

                <div className="flex-1">
                  <input
                    className="input"
                    name="profilePhoto"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={e => {
                      const file = e.target.files?.[0];

                      if (!file) return;

                      if (
                        ![
                          'image/png',
                          'image/jpeg',
                          'image/webp'
                        ].includes(file.type)
                      ) {
                        setErr('Profile photo must be JPG, PNG or WEBP.');
                        e.currentTarget.value = '';
                        return;
                      }

                      if (file.size > 2 * 1024 * 1024) {
                        setErr('Profile photo must be 2 MB or smaller.');
                        e.currentTarget.value = '';
                        return;
                      }

                      const reader = new FileReader();

                      reader.onload = () => {
                        const result = String(reader.result || '');

                        setPhotoFileData(result);
                        setPhotoFileName(file.name);
                        setPhotoPreview(result);
                        setErr('');
                      };

                      reader.onerror = () => {
                        setErr('Could not read the selected profile photo.');
                      };

                      reader.readAsDataURL(file);
                    }}
                  />

                  <div className="mt-2 text-xs muted">
                    Choose a JPG, PNG or WEBP image from your computer. Maximum size: 2 MB.
                  </div>

                  {photoFileName && (
                    <div className="mt-2 text-xs font-semibold text-slate-700">
                      Selected: {photoFileName}
                    </div>
                  )}
                </div>

              </div>
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

            {(selectedRole === 'TEAM_LEAD' || editing?.role === 'TEAM_LEAD') && (
              <div>
                <label className="label">
                  Assign Admin
                </label>
                <select
                  className="input mt-1"
                  name="adminId"
                  defaultValue={editing?.admin_id || ''}
                  required={selectedRole === 'TEAM_LEAD' || editing?.role === 'TEAM_LEAD'}
                >
                  <option value="">
                    Select Admin
                  </option>
                  {admins.map(admin => (
                    <option key={admin.id} value={admin.id}>
                      {admin.employee_code} — {admin.first_name} {admin.last_name}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-xs muted">
                  This Team Lead will be connected to the selected Admin.
                </div>
              </div>
            )}

            {editing ? (
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
                  setSelectedRole('EMPLOYEE');
                  setPhotoPreview('');
                  setPhotoFileData('');
                  setPhotoFileName('');
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

      {/* EMPLOYEE DETAILS MODAL */}
      {selectedEmployee && (
        <Modal
          title="Employee Details"
          onClose={() => setSelectedEmployee(null)}
        >
          <div className="space-y-6">

            <div className="flex flex-col items-center gap-4 border-b border-slate-200 pb-6 sm:flex-row">

              {selectedEmployee.photo_url ? (
                <button
                  type="button"
                  className="group relative shrink-0 rounded-full"
                  onClick={() =>
                    setFullImageUrl(
                      employeePhotoUrl(selectedEmployee.photo_url)
                    )
                  }
                  title="Click to view full image"
                >
                  <img
                    src={employeePhotoUrl(selectedEmployee.photo_url)}
                    alt={`${selectedEmployee.first_name} ${selectedEmployee.last_name}`}
                    className="h-28 w-28 rounded-full border-4 border-white object-cover shadow-md transition group-hover:scale-[1.03]"
                  />

                  <span className="absolute inset-x-2 bottom-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                    View photo
                  </span>
                </button>
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-slate-100 text-3xl font-extrabold text-slate-700 shadow-sm">
                  {selectedEmployee.first_name?.charAt(0)?.toUpperCase()}
                  {selectedEmployee.last_name?.charAt(0)?.toUpperCase()}
                </div>
              )}

              <div className="text-center sm:text-left">
                <h2 className="text-2xl font-extrabold text-slate-900">
                  {selectedEmployee.first_name}{' '}
                  {selectedEmployee.last_name}
                </h2>

                <div className="mt-1 text-sm muted">
                  {selectedEmployee.employee_code}
                </div>

                <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
                  <span className="badge">
                    {selectedEmployee.role?.replace(/_/g, ' ') || '—'}
                  </span>

                  <span className="badge">
                    {selectedEmployee.user_type || '—'}
                  </span>

                  <span className="badge">
                    {selectedEmployee.status || '—'}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Email
                </div>
                <div className="mt-1 break-all font-medium">
                  {selectedEmployee.email || '—'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Phone
                </div>
                <div className="mt-1 font-medium">
                  {selectedEmployee.phone || '—'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Job Title
                </div>
                <div className="mt-1 font-medium">
                  {selectedEmployee.job_title || '—'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Department
                </div>
                <div className="mt-1 font-medium">
                  {selectedEmployee.department_name || '—'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Team Lead
                </div>
                <div className="mt-1 font-medium">
                  {selectedEmployee.team_lead_name || '—'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Admin
                </div>
                <div className="mt-1 font-medium">
                  {selectedEmployee.admin_name || '—'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Joining Date
                </div>
                <div className="mt-1 font-medium">
                  {selectedEmployee.joining_date
                    ? new Date(selectedEmployee.joining_date).toLocaleDateString()
                    : '—'}
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Account Status
                </div>
                <div className="mt-1 font-medium">
                  {selectedEmployee.status || '—'}
                </div>
              </div>

            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">

              <button
                type="button"
                className="btn"
                onClick={() => setSelectedEmployee(null)}
              >
                Close
              </button>

              {isSuper && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setEditing(selectedEmployee);
                    setSelectedRole(selectedEmployee.role || 'EMPLOYEE');
                    setPhotoPreview(employeePhotoUrl(selectedEmployee.photo_url));
                    setPhotoFileData('');
                    setPhotoFileName('');
                    setSelectedEmployee(null);
                    setShow(true);
                  }}
                >
                  Edit Employee
                </button>
              )}

            </div>

          </div>
        </Modal>
      )}

      {/* FULL PROFILE PHOTO */}
      {fullImageUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setFullImageUrl('')}
        >
          <div
            className="relative flex max-h-[92vh] max-w-[92vw] items-center justify-center"
            onClick={e => e.stopPropagation()}
          >
            <img
              src={fullImageUrl}
              alt="Full profile"
              className="max-h-[90vh] max-w-[90vw] rounded-2xl bg-white object-contain shadow-2xl"
            />

            <button
              type="button"
              className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl font-bold text-slate-800 shadow-lg hover:bg-slate-100"
              onClick={() => setFullImageUrl('')}
              aria-label="Close full profile image"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>
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