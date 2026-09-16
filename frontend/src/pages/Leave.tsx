import { FormEvent, useEffect, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, Modal, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

export default function Leave() {
  const { user } = useAuth();

  const isSuper = user?.role === 'SUPER_ADMIN';
  const canApprove = isSuper;

  const [rows, setRows] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const [deleteLeave, setDeleteLeave] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [err, setErr] = useState('');
  const [pageErr, setPageErr] = useState('');

  const [decision, setDecision] = useState<{
    id: number;
    status: string;
  } | null>(null);

  const [comment, setComment] = useState('');

  async function load() {
    try {
      setPageErr('');

      const r = await api.get('/leave');

      setRows(r.data);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function recalculatePerformance() {
    try {
      await api.post('/performance/calculate');
    } catch {
      // The leave action itself has succeeded. Do not block it if the
      // optional immediate performance refresh fails.
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setErr('');

    try {
      const body: any = Object.fromEntries(
        new FormData(e.currentTarget).entries()
      );

      if (
        body.startDate &&
        body.endDate &&
        String(body.endDate) < String(body.startDate)
      ) {
        setErr('To Date cannot be earlier than From Date.');
        return;
      }

      if (editing) {
        await api.put(`/leave/${editing.id}`, body);
      } else {
        await api.post('/leave', body);
      }

      // Recalculate immediately. Pending leave is ignored by the backend,
      // so deductions change only once the leave is approved.
      await recalculatePerformance();

      setShow(false);
      setEditing(null);

      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  async function submitDecision() {
    if (!decision) return;

    try {
      setErr('');

      await api.put(`/leave/${decision.id}/decision`, {
        status: decision.status,
        comment: comment.trim(),
      });

      // Approval/rejection updates performance immediately; it does not wait
      // for the leave date to arrive.
      await recalculatePerformance();

      setDecision(null);
      setComment('');

      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  async function remove() {
    if (!deleteLeave) return;

    try {
      setDeleting(true);
      setPageErr('');

      await api.delete(`/leave/${deleteLeave.id}`);

      await recalculatePerformance();

      setDeleteLeave(null);

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
        title="Leave Management"
        subtitle="Apply, review and track leave requests"
        action={
          <button
            className="btn btn-accent"
            onClick={() => {
              setEditing(null);
              setErr('');
              setShow(true);
            }}
          >
            + Apply Leave
          </button>
        }
      />

      {/* Page Error */}
      {pageErr && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {pageErr}
        </div>
      )}

      {/* Leave Table */}
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {user?.role !== 'EMPLOYEE' && (
                  <th>Employee</th>
                )}

                <th>Type</th>
                <th>Dates</th>
                <th>Reason</th>
                <th>Reference</th>
                <th>Status</th>

                {canApprove && (
                  <th>Approval</th>
                )}

                {isSuper && (
                  <th>Manage</th>
                )}
              </tr>
            </thead>

            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  {user?.role !== 'EMPLOYEE' && (
                    <td>
                      <b>{r.employee_name}</b>

                      <div className="text-xs text-orange">
                        {r.employee_code} • {r.user_type}
                      </div>

                      <div className="text-xs muted">
                        {r.department_name || 'No department'}
                      </div>
                    </td>
                  )}

                  <td>
                    {r.leave_type}
                  </td>

                  <td>
                    {new Date(
                      r.start_date
                    ).toLocaleDateString()}

                    {' – '}

                    {new Date(
                      r.end_date
                    ).toLocaleDateString()}
                  </td>

                  <td>
                    <div className="max-w-[280px] overflow-hidden break-all whitespace-normal">
                      {r.reason}
                    </div>
                  </td>

                  <td>
                    {r.reference_link ? (
                      <a
                        href={r.reference_link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-orange underline break-all"
                      >
                        Open reference
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>

                  <td>
                    <span className="badge">
                      {r.status}
                    </span>
                  </td>

                  {canApprove && (
                    <td>
                      {r.status === 'PENDING' ? (
                        <div className="flex gap-2">

                          <button
                            className="btn btn-accent !px-3 !py-1.5"
                            onClick={() => {
                              setComment('');

                              setDecision({
                                id: r.id,
                                status: 'APPROVED',
                              });
                            }}
                          >
                            Approve
                          </button>

                          <button
                            className="btn !px-3 !py-1.5"
                            onClick={() => {
                              setComment('');

                              setDecision({
                                id: r.id,
                                status: 'REJECTED',
                              });
                            }}
                          >
                            Reject
                          </button>

                        </div>
                      ) : r.reviewed_by_name ? (
                        <div>
                          <div className="font-medium">
                            {r.status === 'APPROVED'
                              ? 'Approved by'
                              : 'Rejected by'}
                          </div>

                          <div className="text-sm">
                            {r.reviewed_by_name}
                          </div>

                          {r.reviewed_by_role && (
                            <div className="text-xs muted">
                              {r.reviewed_by_role.replace(
                                /_/g,
                                ' '
                              )}
                            </div>
                          )}

                          {r.review_comment && (
                            <div className="mt-1 text-xs muted">
                              {r.review_comment}
                            </div>
                          )}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}

                  {isSuper && (
                    <td>
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
                          onClick={() => setDeleteLeave(r)}
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

      {/* Apply / Edit Leave Modal */}
      {show && (
        <Modal
          title={
            editing
              ? 'Edit Leave Request'
              : 'Apply for Leave'
          }
          onClose={() => {
            setShow(false);
            setEditing(null);
            setErr('');
          }}
        >
          <form
            onSubmit={save}
            className="space-y-4"
          >
            <div>
              <label className="label">
                Leave Type
              </label>

              <select
                className="input mt-1"
                name="type"
                defaultValue={
                  editing?.leave_type || 'PAID'
                }
              >
                <option>PAID</option>
                <option>SICK</option>
                <option>UNPAID</option>
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">

              <div>
                <label className="label">
                  From Date
                </label>

                <input
                  className="input mt-1"
                  type="date"
                  name="startDate"
                  defaultValue={
                    editing?.start_date?.slice?.(
                      0,
                      10
                    ) || ''
                  }
                  required
                />
              </div>

              <div>
                <label className="label">
                  To Date
                </label>

                <input
                  className="input mt-1"
                  type="date"
                  name="endDate"
                  defaultValue={
                    editing?.end_date?.slice?.(
                      0,
                      10
                    ) || ''
                  }
                  required
                />
              </div>

            </div>

            <div>
              <label className="label">
                Reason
              </label>

              <textarea
                className="input mt-1 min-h-28"
                name="reason"
                placeholder="Reason for leave"
                defaultValue={
                  editing?.reason || ''
                }
                required
              />
            </div>

            <div>
              <label className="label">Reference Link <span className="muted">(optional)</span></label>
              <input
                className="input mt-1"
                type="url"
                name="referenceLink"
                placeholder="Optional supporting reference link"
                defaultValue={editing?.reference_link || ''}
              />
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

              <button
                type="submit"
                className="btn btn-primary"
              >
                {editing
                  ? 'Save Changes'
                  : 'Submit Request'}
              </button>

            </div>
          </form>
        </Modal>
      )}

      {/* Approve / Reject Modal */}
      {decision && (
        <Modal
          title={
            decision.status === 'APPROVED'
              ? 'Approve Leave Request'
              : 'Reject Leave Request'
          }
          onClose={() => {
            setDecision(null);
            setComment('');
            setErr('');
          }}
        >
          <div className="space-y-4">

            <div>
              <label className="label">
                Comment{' '}
                <span className="muted">
                  (optional)
                </span>
              </label>

              <textarea
                className="input mt-1 min-h-28"
                placeholder={
                  decision.status === 'APPROVED'
                    ? 'Add a comment for this approval...'
                    : 'Add a reason for rejecting this leave...'
                }
                value={comment}
                onChange={e =>
                  setComment(e.target.value)
                }
              />
            </div>

            {err && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {err}
              </div>
            )}

            <div className="flex justify-end gap-3">

              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDecision(null);
                  setComment('');
                  setErr('');
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-accent"
                onClick={() =>
                  void submitDecision()
                }
              >
                {decision.status === 'APPROVED'
                  ? 'Approve Leave'
                  : 'Reject Leave'}
              </button>

            </div>

          </div>
        </Modal>
      )}

      {/* Delete Leave Confirmation Modal */}
      {deleteLeave && (
        <Modal
          title="Delete Leave Request?"
          onClose={() => {
            if (!deleting) {
              setDeleteLeave(null);
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
                    Are you sure you want to delete this leave request?
                  </h3>

                  <p className="mt-1 text-sm text-red-700">
                    This action cannot be undone.
                  </p>
                </div>

              </div>

            </div>

            {/* Leave Details */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">

              {deleteLeave.employee_name && (
                <div className="font-semibold text-slate-900">
                  {deleteLeave.employee_name}
                </div>
              )}

              {deleteLeave.employee_code && (
                <div className="mt-1 text-sm muted">
                  {deleteLeave.employee_code}
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">

                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs muted">
                    Leave Type
                  </div>

                  <div className="mt-1 font-medium">
                    {deleteLeave.leave_type}
                  </div>
                </div>

                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs muted">
                    Status
                  </div>

                  <div className="mt-1">
                    <span className="badge">
                      {deleteLeave.status}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg bg-white p-3 sm:col-span-2">
                  <div className="text-xs muted">
                    Leave Dates
                  </div>

                  <div className="mt-1 font-medium">
                    {new Date(
                      deleteLeave.start_date
                    ).toLocaleDateString()}

                    {' – '}

                    {new Date(
                      deleteLeave.end_date
                    ).toLocaleDateString()}
                  </div>
                </div>

              </div>

              {deleteLeave.reason && (
                <div className="mt-3 rounded-lg bg-white p-3">
                  <div className="text-xs muted">
                    Reason
                  </div>

                  <div className="mt-1 break-words text-sm">
                    {deleteLeave.reason}
                  </div>
                </div>
              )}

            </div>

            <p className="text-sm muted">
              Deleting this request will permanently remove it from
              the leave records.
            </p>

            {/* Buttons */}
            <div className="flex justify-end gap-3">

              <button
                type="button"
                className="btn"
                disabled={deleting}
                onClick={() =>
                  setDeleteLeave(null)
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
                  : 'Delete Leave'}
              </button>

            </div>

          </div>
        </Modal>
      )}

    </>
  );
}
