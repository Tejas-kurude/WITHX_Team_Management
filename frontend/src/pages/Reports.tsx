import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, Modal, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

export default function Reports() {
  const { user } = useAuth();

  const isSuper = user?.role === 'SUPER_ADMIN';

  const [rows, setRows] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const [err, setErr] = useState('');
  const [pageErr, setPageErr] = useState('');
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');

  /* =========================================
     REVIEW MODAL STATES
  ========================================= */

  const [reviewReport, setReviewReport] = useState<any | null>(null);

  const [reviewDecision, setReviewDecision] = useState<
    'APPROVE' | 'NEEDS_CHANGES' | 'REJECT' | null
  >(null);

  const [reviewComment, setReviewComment] = useState('');

  const [reviewing, setReviewing] = useState(false);

  /* =========================================
     DELETE MODAL STATES
  ========================================= */

  const [deleteReport, setDeleteReport] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* =========================================
     LOAD REPORTS
  ========================================= */

  async function load() {
    try {
      setPageErr('');

      const r = await api.get('/reports');

      setRows(r.data);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  /* =========================================
     CREATE / EDIT REPORT
  ========================================= */

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    setErr('');

    try {
      const body = Object.fromEntries(
        new FormData(e.currentTarget).entries()
      );

      if (editing) {
        await api.put(`/reports/${editing.id}`, body);
      } else {
        await api.post('/reports', body);
      }

      setShow(false);
      setEditing(null);

      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  /* =========================================
     OPEN REVIEW MODAL
  ========================================= */

  function openReview(
    report: any,
    decision: 'APPROVE' | 'NEEDS_CHANGES' | 'REJECT'
  ) {
    setReviewReport(report);
    setReviewDecision(decision);
    setReviewComment('');
    setErr('');
  }

  /* =========================================
     SUBMIT REVIEW
  ========================================= */

  async function submitReview() {
    if (!reviewReport || !reviewDecision) return;

    if (
      reviewDecision !== 'APPROVE' &&
      !reviewComment.trim()
    ) {
      setErr(
        reviewDecision === 'REJECT'
          ? 'Please provide a reason for rejection.'
          : 'Please explain what changes are required.'
      );

      return;
    }

    try {
      setReviewing(true);
      setErr('');

      await api.put(
        `/reports/${reviewReport.id}/review`,
        {
          decision: reviewDecision,
          reviewComment: reviewComment.trim(),
        }
      );

      setReviewReport(null);
      setReviewDecision(null);
      setReviewComment('');

      await load();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setReviewing(false);
    }
  }

  /* =========================================
     DELETE REPORT
  ========================================= */

  async function remove() {
    if (!deleteReport) return;

    try {
      setDeleting(true);
      setPageErr('');

      await api.delete(
        `/reports/${deleteReport.id}`
      );

      setDeleteReport(null);

      await load();
    } catch (e) {
      setPageErr(messageOf(e));
    } finally {
      setDeleting(false);
    }
  }

  /* =========================================
     CAN REVIEW
  ========================================= */

  function canReview(r: any) {
    if (!user || r.employee_id === user.employeeId) {
      return false;
    }

    if (user.role === 'SUPER_ADMIN') {
      return [
        'PENDING',
        'APPROVED_BY_TEAM_LEAD',
        'APPROVED_BY_ADMIN',
      ].includes(r.review_status);
    }

    if (user.role === 'ADMIN') {
      return [
        'PENDING',
        'APPROVED_BY_TEAM_LEAD',
      ].includes(r.review_status);
    }

    if (user.role === 'TEAM_LEAD') {
      return r.review_status === 'PENDING';
    }

    return false;
  }

  /* =========================================
     STATUS TEXT
  ========================================= */

  function statusText(status: string) {
    return (
      {
        PENDING:
          'Awaiting Team Lead / higher review',

        APPROVED_BY_TEAM_LEAD:
          'Team Lead approved • Awaiting Admin / Super Admin',

        APPROVED_BY_ADMIN:
          'Admin approved • Awaiting Super Admin',

        REVIEWED:
          'Fully approved',

        NEEDS_CHANGES:
          'Needs changes',

        REJECTED:
          'Rejected',
      } as any
    )[status] || status;
  }

  function statusShort(status: string) {
    return ({
      PENDING: 'Pending',
      APPROVED_BY_TEAM_LEAD: 'TL Approved',
      APPROVED_BY_ADMIN: 'Admin Approved',
      REVIEWED: 'Approved',
      NEEDS_CHANGES: 'Needs Changes',
      REJECTED: 'Rejected',
    } as any)[status] || status;
  }

  function statusClass(status: string) {
    if (status === 'REVIEWED') return 'border-green-200 bg-green-50 text-green-700';
    if (status === 'APPROVED_BY_TEAM_LEAD' || status === 'APPROVED_BY_ADMIN') return 'border-blue-200 bg-blue-50 text-blue-700';
    if (status === 'NEEDS_CHANGES') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (status === 'REJECTED') return 'border-red-200 bg-red-50 text-red-700';
    return 'border-slate-200 bg-slate-100 text-slate-700';
  }

  function formatReportDate(value: string) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function shortText(value: string, limit = 75) {
    if (!value) return '—';
    return value.length > limit ? `${value.slice(0, limit)}...` : value;
  }

  const departments = useMemo(
    () => Array.from(new Set(rows.map(r => r.department_name).filter(Boolean))).sort(),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      const matchesSearch = !q ||
        String(r.employee_name || '').toLowerCase().includes(q) ||
        String(r.employee_code || '').toLowerCase().includes(q) ||
        String(r.completed_work || '').toLowerCase().includes(q) ||
        String(r.tasks_worked || '').toLowerCase().includes(q) ||
        String(r.tomorrow_plan || '').toLowerCase().includes(q) ||
        String(r.blockers || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'ALL' || r.review_status === statusFilter;
      const matchesDepartment = departmentFilter === 'ALL' || r.department_name === departmentFilter;
      const matchesDate = !dateFilter || (r.report_date && new Date(r.report_date).toLocaleDateString('en-CA') === dateFilter);
      return matchesSearch && matchesStatus && matchesDepartment && matchesDate;
    });
  }, [rows, search, statusFilter, departmentFilter, dateFilter]);

  return (
    <>
      {/* =========================================
          PAGE TITLE
      ========================================= */}

      <PageTitle
        title="Daily Work Reports"
        subtitle="Daily accomplishments with Team Lead → Admin → Super Admin approval hierarchy"
        action={
          <button
            className="btn btn-accent"
            onClick={() => {
              setEditing(null);
              setErr('');
              setShow(true);
            }}
          >
            + Submit Report
          </button>
        }
      />

      {/* =========================================
          PAGE ERROR
      ========================================= */}

      {pageErr && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {pageErr}
        </div>
      )}

      {/* =========================================
          REPORT FILTERS
      ========================================= */}

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-12">
          <div className={user?.role === 'EMPLOYEE' ? 'lg:col-span-5' : 'lg:col-span-4'}>
            <input
              className="input w-full"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={user?.role === 'EMPLOYEE' ? 'Search report content' : 'Search employee, ID or report content'}
            />
          </div>

          <div className="lg:col-span-3">
            <select className="input w-full" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="ALL">All review statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED_BY_TEAM_LEAD">Team Lead approved</option>
              <option value="APPROVED_BY_ADMIN">Admin approved</option>
              <option value="REVIEWED">Fully approved</option>
              <option value="NEEDS_CHANGES">Needs changes</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          {user?.role !== 'EMPLOYEE' && (
            <div className="lg:col-span-2">
              <select className="input w-full" value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}>
                <option value="ALL">All departments</option>
                {departments.map(department => (
                  <option key={String(department)} value={String(department)}>{String(department)}</option>
                ))}
              </select>
            </div>
          )}

          <div className="lg:col-span-2">
            <input className="input w-full" type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} />
          </div>

          <div className="lg:col-span-1">
            <button
              type="button"
              className="btn w-full"
              onClick={() => {
                setSearch('');
                setStatusFilter('ALL');
                setDepartmentFilter('ALL');
                setDateFilter('');
              }}
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
        <span className="font-semibold text-slate-600">Daily Reports</span>
        <span className="font-semibold text-slate-500">Showing: {filteredRows.length} of {rows.length}</span>
      </div>

      {/* =========================================
          REPORT TABLE
      ========================================= */}

      {filteredRows.length ? (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr className="text-xs font-extrabold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-4">Date</th>
                  {user?.role !== 'EMPLOYEE' && <th className="px-4 py-4">Employee</th>}
                  {user?.role !== 'EMPLOYEE' && <th className="px-4 py-4">Department</th>}
                  <th className="px-4 py-4">Completed Work</th>
                  <th className="px-4 py-4 text-center">Hours</th>
                  <th className="px-4 py-4 text-center">Status</th>
                  <th className="px-4 py-4 text-right">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {filteredRows.map(r => (
                  <tr key={r.id} className="bg-white transition hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-4 align-middle text-sm font-semibold text-slate-700">
                      {formatReportDate(r.report_date)}
                    </td>

                    {user?.role !== 'EMPLOYEE' && (
                      <td className="px-4 py-4 align-middle">
                        <div className="font-extrabold text-slate-900">{r.employee_name || '—'}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">
                          {r.employee_code || '—'}{r.user_type ? ` • ${r.user_type}` : ''}
                        </div>
                      </td>
                    )}

                    {user?.role !== 'EMPLOYEE' && (
                      <td className="px-4 py-4 align-middle text-sm font-semibold text-slate-700">
                        {r.department_name || '—'}
                      </td>
                    )}

                    <td className="max-w-[430px] px-4 py-4 align-middle">
                      <div className="text-sm font-semibold leading-5 text-slate-800">{shortText(r.completed_work)}</div>
                      {r.tasks_worked && <div className="mt-1 text-xs text-slate-500">Tasks: {shortText(r.tasks_worked, 55)}</div>}
                    </td>

                    <td className="whitespace-nowrap px-4 py-4 align-middle text-center text-sm font-bold text-slate-700">
                      {r.hours_worked ?? '—'}
                    </td>

                    <td className="px-4 py-4 align-middle text-center">
                      <span className={`inline-flex min-w-[92px] items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-extrabold ${statusClass(r.review_status)}`}>
                        {statusShort(r.review_status)}
                      </span>
                    </td>

                    <td className="px-4 py-4 align-middle">
                      <div className="flex justify-end">
                        <button type="button" className="btn !px-3 !py-2 text-xs font-bold" onClick={() => setSelectedReport(r)}>
                          View Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        !pageErr && <Empty />
      )}

      {/* =========================================
          REPORT DETAILS MODAL
      ========================================= */}

      {selectedReport && (
        <Modal title="Daily Report Details" onClose={() => setSelectedReport(null)}>
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-extrabold text-slate-900">
                    {user?.role === 'EMPLOYEE' ? 'My Daily Report' : selectedReport.employee_name || 'Daily Report'}
                  </div>
                  {user?.role !== 'EMPLOYEE' && (
                    <div className="mt-1 text-sm font-bold text-orange">
                      {selectedReport.employee_code || '—'}
                      {selectedReport.user_type ? ` • ${selectedReport.user_type}` : ''}
                      {' • '}{selectedReport.department_name || 'No department'}
                    </div>
                  )}
                  <div className="mt-2 text-sm font-semibold text-slate-500">
                    Report Date: {formatReportDate(selectedReport.report_date)}
                  </div>
                </div>

                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-extrabold ${statusClass(selectedReport.review_status)}`}>
                  {statusShort(selectedReport.review_status)}
                </span>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="label">Hours Worked</div>
                <div className="mt-1 font-bold text-slate-900">{selectedReport.hours_worked ?? '—'}</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="label">Review Status</div>
                <div className="mt-1 text-sm font-semibold text-slate-700">{statusText(selectedReport.review_status)}</div>
              </div>
            </div>

            <div>
              <div className="label">Completed Work</div>
              <div className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                {selectedReport.completed_work || '—'}
              </div>
            </div>

            {selectedReport.tasks_worked && (
              <div>
                <div className="label">Tasks Worked On</div>
                <div className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                  {selectedReport.tasks_worked}
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="label">Problems / Blockers</div>
                <div className="mt-2 min-h-[88px] whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                  {selectedReport.blockers || 'None'}
                </div>
              </div>
              <div>
                <div className="label">Plan for Tomorrow</div>
                <div className="mt-2 min-h-[88px] whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                  {selectedReport.tomorrow_plan || '—'}
                </div>
              </div>
            </div>

            {selectedReport.comments && (
              <div>
                <div className="label">Additional Comments</div>
                <div className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                  {selectedReport.comments}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <b>Approval flow:</b> Team Lead → Admin → Super Admin. A higher-level reviewer may approve directly and skip pending lower levels.
            </div>

            {selectedReport.review_comment && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <b>Latest review comment:</b> {selectedReport.review_comment}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
              {canReview(selectedReport) && (
                <>
                  <button className="btn btn-accent" onClick={() => { setSelectedReport(null); openReview(selectedReport, 'APPROVE'); }}>
                    Approve
                  </button>
                  <button className="btn" onClick={() => { setSelectedReport(null); openReview(selectedReport, 'NEEDS_CHANGES'); }}>
                    Needs Changes
                  </button>
                  <button className="btn text-red-600" onClick={() => { setSelectedReport(null); openReview(selectedReport, 'REJECT'); }}>
                    Reject
                  </button>
                </>
              )}

              {isSuper && (
                <>
                  <button className="btn" onClick={() => { setSelectedReport(null); setEditing(selectedReport); setErr(''); setShow(true); }}>
                    Edit
                  </button>
                  <button className="btn text-red-600" onClick={() => { setSelectedReport(null); setDeleteReport(selectedReport); }}>
                    Delete
                  </button>
                </>
              )}

              <button type="button" className="btn btn-primary" onClick={() => setSelectedReport(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* =========================================
          CREATE / EDIT REPORT MODAL
      ========================================= */}

      {show && (
        <Modal
          title={
            editing
              ? 'Edit Daily Work Report'
              : 'Submit Daily Work Report'
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
                Report Date
              </label>

              <input
                className="input mt-1"
                type="date"
                name="reportDate"
                defaultValue={
                  editing?.report_date?.slice?.(
                    0,
                    10
                  ) || ''
                }
              />
            </div>

            <div>
              <label className="label">
                Completed Work
              </label>

              <textarea
                className="input mt-1 min-h-24"
                name="completed"
                placeholder="What did you complete today?"
                defaultValue={
                  editing?.completed_work || ''
                }
                required
              />
            </div>

            <div>
              <label className="label">
                Tasks Worked On
              </label>

              <textarea
                className="input mt-1"
                name="tasksWorked"
                placeholder="Tasks worked on"
                defaultValue={
                  editing?.tasks_worked || ''
                }
              />
            </div>

            <div>
              <label className="label">
                Hours Worked
              </label>

              <input
                className="input mt-1"
                name="hoursWorked"
                type="number"
                step="0.25"
                min="0"
                max="24"
                placeholder="Hours worked"
                defaultValue={
                  editing?.hours_worked ?? ''
                }
              />
            </div>

            <div>
              <label className="label">
                Problems / Blockers
              </label>

              <textarea
                className="input mt-1"
                name="blockers"
                placeholder="Problems / blockers"
                defaultValue={
                  editing?.blockers || ''
                }
              />
            </div>

            <div>
              <label className="label">
                Plan for Tomorrow
              </label>

              <textarea
                className="input mt-1"
                name="tomorrowPlan"
                placeholder="Plan for tomorrow"
                defaultValue={
                  editing?.tomorrow_plan || ''
                }
              />
            </div>

            <div>
              <label className="label">
                Additional Comments
              </label>

              <textarea
                className="input mt-1"
                name="comments"
                placeholder="Additional comments"
                defaultValue={
                  editing?.comments || ''
                }
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
                  : 'Submit Report'}
              </button>

            </div>

          </form>
        </Modal>
      )}

      {/* =========================================
          REVIEW REPORT MODAL
      ========================================= */}

      {reviewReport && reviewDecision && (
        <Modal
          title={
            reviewDecision === 'APPROVE'
              ? 'Approve Daily Report'
              : reviewDecision ===
                'NEEDS_CHANGES'
              ? 'Request Changes'
              : 'Reject Daily Report'
          }
          onClose={() => {
            if (!reviewing) {
              setReviewReport(null);
              setReviewDecision(null);
              setReviewComment('');
              setErr('');
            }
          }}
        >
          <div className="space-y-5">

            {/* REPORT INFO */}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">

              <div className="font-semibold text-slate-900">
                {reviewReport.employee_name ||
                  'Daily Report'}
              </div>

              {reviewReport.employee_code && (
                <div className="mt-1 text-sm muted">
                  {reviewReport.employee_code}
                  {' • '}
                  {reviewReport.department_name ||
                    'No department'}
                </div>
              )}

              <div className="mt-2 text-sm">
                Report Date:{' '}
                <b>
                  {new Date(
                    reviewReport.report_date
                  ).toLocaleDateString()}
                </b>
              </div>

            </div>

            {/* APPROVE MESSAGE */}

            {reviewDecision === 'APPROVE' && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <div className="font-semibold text-green-800">
                  ✓ Approve this daily work report?
                </div>

                <p className="mt-1 text-sm text-green-700">
                  Your approval will be recorded
                  in the report approval hierarchy.
                </p>
              </div>
            )}

            {/* COMMENT */}

            <div>
              <label className="label">
                {reviewDecision === 'REJECT'
                  ? 'Reason for Rejection'
                  : reviewDecision ===
                    'NEEDS_CHANGES'
                  ? 'Required Changes'
                  : 'Comment'}

                {reviewDecision ===
                'APPROVE' ? (
                  <span className="muted">
                    {' '}
                    (optional)
                  </span>
                ) : (
                  <span className="text-red-600">
                    {' '}
                    *
                  </span>
                )}
              </label>

              <textarea
                className="input mt-1 min-h-28"
                value={reviewComment}
                onChange={e =>
                  setReviewComment(
                    e.target.value
                  )
                }
                placeholder={
                  reviewDecision === 'REJECT'
                    ? 'Explain why this report is being rejected...'
                    : reviewDecision ===
                      'NEEDS_CHANGES'
                    ? 'Explain what changes are required...'
                    : 'Add an optional approval comment...'
                }
              />
            </div>

            {err && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {err}
              </div>
            )}

            {/* BUTTONS */}

            <div className="flex justify-end gap-3">

              <button
                type="button"
                className="btn"
                disabled={reviewing}
                onClick={() => {
                  setReviewReport(null);
                  setReviewDecision(null);
                  setReviewComment('');
                  setErr('');
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={reviewing}
                className={
                  reviewDecision ===
                  'APPROVE'
                    ? 'btn btn-accent'
                    : reviewDecision ===
                      'REJECT'
                    ? 'btn bg-red-600 text-white hover:bg-red-700'
                    : 'btn btn-primary'
                }
                onClick={() =>
                  void submitReview()
                }
              >
                {reviewing
                  ? 'Processing...'
                  : reviewDecision ===
                    'APPROVE'
                  ? 'Approve Report'
                  : reviewDecision ===
                    'NEEDS_CHANGES'
                  ? 'Request Changes'
                  : 'Reject Report'}
              </button>

            </div>

          </div>
        </Modal>
      )}

      {/* =========================================
          DELETE REPORT MODAL
      ========================================= */}

      {deleteReport && (
        <Modal
          title="Delete Daily Report?"
          onClose={() => {
            if (!deleting) {
              setDeleteReport(null);
            }
          }}
        >
          <div className="space-y-5">

            {/* WARNING */}

            <div className="rounded-xl border border-red-200 bg-red-50 p-4">

              <div className="flex items-start gap-3">

                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-xl">
                  ⚠️
                </div>

                <div>
                  <h3 className="font-semibold text-red-800">
                    Are you sure you want to delete this daily report?
                  </h3>

                  <p className="mt-1 text-sm text-red-700">
                    This action cannot be undone.
                  </p>
                </div>

              </div>

            </div>

            {/* REPORT INFO */}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">

              <div className="font-semibold text-slate-900">
                {deleteReport.employee_name ||
                  'Daily Work Report'}
              </div>

              {deleteReport.employee_code && (
                <div className="mt-1 text-sm muted">
                  {deleteReport.employee_code}
                  {' • '}
                  {deleteReport.department_name ||
                    'No department'}
                </div>
              )}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">

                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs muted">
                    Report Date
                  </div>

                  <div className="mt-1 font-medium">
                    {new Date(
                      deleteReport.report_date
                    ).toLocaleDateString()}
                  </div>
                </div>

                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs muted">
                    Status
                  </div>

                  <div className="mt-1">
                    <span className="badge">
                      {statusText(
                        deleteReport.review_status
                      )}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs muted">
                    Hours Worked
                  </div>

                  <div className="mt-1 font-medium">
                    {deleteReport.hours_worked ||
                      '—'}
                  </div>
                </div>

                <div className="rounded-lg bg-white p-3">
                  <div className="text-xs muted">
                    Employee
                  </div>

                  <div className="mt-1 font-medium">
                    {deleteReport.employee_name ||
                      '—'}
                  </div>
                </div>

              </div>

              {deleteReport.completed_work && (
                <div className="mt-3 rounded-lg bg-white p-3">

                  <div className="text-xs muted">
                    Completed Work
                  </div>

                  <div className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {deleteReport.completed_work}
                  </div>

                </div>
              )}

            </div>

            {/* IMPORTANT MESSAGE */}

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Deleting this report may also remove
              its review information and approval
              history.
            </div>

            {/* BUTTONS */}

            <div className="flex justify-end gap-3">

              <button
                type="button"
                className="btn"
                disabled={deleting}
                onClick={() =>
                  setDeleteReport(null)
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
                  : 'Delete Report'}
              </button>

            </div>

          </div>
        </Modal>
      )}

    </>
  );
}