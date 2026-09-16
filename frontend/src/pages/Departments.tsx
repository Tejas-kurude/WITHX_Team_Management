import { FormEvent, useEffect, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, Modal, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

export default function Departments() {
  const { user } = useAuth();

  const isSuper = user?.role === 'SUPER_ADMIN';
  const canCreate = ['SUPER_ADMIN', 'ADMIN'].includes(user?.role || '');

  const [rows, setRows] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [detail, setDetail] = useState<any | null>(null);

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const [deleteDepartment, setDeleteDepartment] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [err, setErr] = useState('');
  const [pageErr, setPageErr] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    try {
      setPageErr('');

      const r = await api.get('/departments', {
        params: {
          search: q
        }
      });

      setRows(r.data);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  useEffect(() => {
    void load();

    if (canCreate) {
      void api
        .get('/employees')
        .then(r => setEmps(r.data))
        .catch(() => {});
    }
  }, []);

  async function openDetail(id: number) {
    try {
      setPageErr('');

      const r = await api.get(`/departments/${id}`);

      setDetail(r.data);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setErr('');

    try {
      const body = Object.fromEntries(
        new FormData(e.currentTarget).entries()
      );

      if (editing) {
        await api.put(`/departments/${editing.id}`, body);
      } else {
        await api.post('/departments', body);
      }

      setShow(false);
      setEditing(null);

      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  async function remove() {
    if (!deleteDepartment) return;

    try {
      setDeleting(true);
      setPageErr('');

      await api.delete(`/departments/${deleteDepartment.id}`);

      setDeleteDepartment(null);

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
        title="Department Management"
        subtitle="Department members, heads and employee/intern counts"
        action={
          canCreate ? (
            <button
              className="btn btn-accent"
              onClick={() => {
                setEditing(null);
                setErr('');
                setShow(true);
              }}
            >
              + Department
            </button>
          ) : undefined
        }
      />

      {/* Search */}
      <div className="card mb-5 flex gap-2 p-4">
        <input
          className="input"
          placeholder="Search department"
          value={q}
          onChange={e => setQ(e.target.value)}
        />

        <button
          className="btn btn-primary"
          onClick={() => void load()}
        >
          Search
        </button>
      </div>

      {/* Page Error */}
      {pageErr && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {pageErr}
        </div>
      )}

      {/* Department Cards */}
      {rows.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">

          {rows.map(r => (
            <div
              className="card p-5"
              key={r.id}
            >
              <div className="flex items-start justify-between gap-3">

                <div>
                  <h3 className="text-lg font-extrabold">
                    {r.name}
                  </h3>

                  <div className="orange-line" />
                </div>

                {isSuper && (
                  <div className="flex gap-2">

                    <button
                      className="btn !px-3 !py-1.5"
                      onClick={() => {
                        setEditing(r);
                        setErr('');
                        setShow(true);
                      }}
                    >
                      Edit
                    </button>

                    <button
                      className="btn !px-3 !py-1.5 text-red-600"
                      onClick={() => setDeleteDepartment(r)}
                    >
                      Delete
                    </button>

                  </div>
                )}

              </div>

              <p className="mt-4 text-sm muted">
                {r.description || 'No description added.'}
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">

                <div className="rounded-lg bg-slate-50 p-2">
                  <b>{r.member_count}</b>

                  <div className="text-xs muted">
                    Total
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-2">
                  <b>{r.employee_count}</b>

                  <div className="text-xs muted">
                    Employees
                  </div>
                </div>

                <div className="rounded-lg bg-slate-50 p-2">
                  <b>{r.intern_count}</b>

                  <div className="text-xs muted">
                    Interns
                  </div>
                </div>

              </div>

              <div className="mt-4 text-sm">
                <span className="muted">
                  Head/Lead:
                </span>{' '}
                {r.head_name || 'Not assigned'}
              </div>

              <button
                className="btn mt-4 w-full"
                onClick={() => void openDetail(r.id)}
              >
                View Department Details
              </button>

            </div>
          ))}

        </div>
      ) : (
        !pageErr && <Empty />
      )}

      {/* Create / Edit Department Modal */}
      {show && (
        <Modal
          title={
            editing
              ? 'Edit Department'
              : 'Create Department'
          }
          onClose={() => {
            setShow(false);
            setEditing(null);
            setErr('');
          }}
        >

          <form
            className="space-y-4"
            onSubmit={save}
          >

            <div>
              <label className="label">
                Department Name
              </label>

              <input
                className="input mt-1"
                name="name"
                placeholder="Department name"
                defaultValue={editing?.name || ''}
                required
              />
            </div>

            <div>
              <label className="label">
                Description
              </label>

              <textarea
                className="input mt-1 min-h-28"
                name="description"
                placeholder="Department description"
                defaultValue={editing?.description || ''}
              />
            </div>

            <div>
              <label className="label">
                Department Head
              </label>

              <select
                className="input mt-1"
                name="headEmployeeId"
                defaultValue={editing?.head_employee_id || ''}
              >
                <option value="">
                  No Department Head
                </option>

                {emps
                  .filter(
                    e =>
                      e.role === 'TEAM_LEAD' ||
                      e.role === 'ADMIN' ||
                      e.role === 'SUPER_ADMIN'
                  )
                  .map(e => (
                    <option
                      key={e.id}
                      value={e.id}
                    >
                      {e.employee_code} — {e.first_name}{' '}
                      {e.last_name}
                    </option>
                  ))}
              </select>
            </div>

            {err && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {err}
              </div>
            )}

            <div className="flex justify-end gap-2">

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
                  : 'Save Department'}
              </button>

            </div>

          </form>

        </Modal>
      )}

      {/* Department Detail Modal */}
      {detail && (
        <Modal
          title={`${detail.name} Department`}
          onClose={() => setDetail(null)}
        >

          <div className="mb-4 text-sm muted">
            Head/Lead:{' '}
            {detail.head_name || 'Not assigned'}
          </div>

          {detail.members?.length ? (
            <div className="table-wrap">

              <table className="table">

                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Role</th>
                    <th>Team Lead</th>
                  </tr>
                </thead>

                <tbody>

                  {detail.members.map((m: any) => (
                    <tr key={m.id}>

                      <td>
                        <b>{m.employee_code}</b>
                      </td>

                      <td>
                        {m.first_name} {m.last_name}
                      </td>

                      <td>
                        {m.user_type}
                      </td>

                      <td>
                        {m.role}
                      </td>

                      <td>
                        {m.team_lead_name || '—'}
                      </td>

                    </tr>
                  ))}

                </tbody>

              </table>

            </div>
          ) : (
            <Empty />
          )}

        </Modal>
      )}

      {/* Delete Department Confirmation Modal */}
      {deleteDepartment && (
        <Modal
          title="Delete Department?"
          onClose={() => {
            if (!deleting) {
              setDeleteDepartment(null);
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
                    Are you sure you want to delete this department?
                  </h3>

                  <p className="mt-1 text-sm text-red-700">
                    This action cannot be undone.
                  </p>
                </div>

              </div>

            </div>

            {/* Department Info */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">

              <div className="font-semibold text-slate-900">
                {deleteDepartment.name}
              </div>

              <div className="mt-2 text-sm muted">
                {deleteDepartment.description ||
                  'No description added.'}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">

                <div className="rounded-lg bg-white p-2">
                  <b>
                    {deleteDepartment.member_count || 0}
                  </b>

                  <div className="text-xs muted">
                    Total
                  </div>
                </div>

                <div className="rounded-lg bg-white p-2">
                  <b>
                    {deleteDepartment.employee_count || 0}
                  </b>

                  <div className="text-xs muted">
                    Employees
                  </div>
                </div>

                <div className="rounded-lg bg-white p-2">
                  <b>
                    {deleteDepartment.intern_count || 0}
                  </b>

                  <div className="text-xs muted">
                    Interns
                  </div>
                </div>

              </div>

            </div>

            {/* Important Message */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              This department can only be deleted if no employees or interns
              are currently assigned to it.
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-3">

              <button
                type="button"
                className="btn"
                disabled={deleting}
                onClick={() =>
                  setDeleteDepartment(null)
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
                  : 'Delete Department'}
              </button>

            </div>

          </div>

        </Modal>
      )}

    </>
  );
}
