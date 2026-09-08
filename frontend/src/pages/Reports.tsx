import { FormEvent, useEffect, useState } from 'react';
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
          REPORT LIST
      ========================================= */}

      {rows.length ? (
        <div className="space-y-4">

          {rows.map(r => (
            <div
              className="card p-5"
              key={r.id}
            >

              {/* REPORT HEADER */}

              <div className="flex flex-wrap justify-between gap-3">

                <div>

                  <h3 className="font-extrabold">
                    {user?.role === 'EMPLOYEE'
                      ? 'My Report'
                      : r.employee_name}
                  </h3>

                  {user?.role !== 'EMPLOYEE' && (
                    <div className="text-xs font-semibold text-orange">
                      {r.employee_code}
                      {' • '}
                      {r.user_type}
                      {' • '}
                      {r.department_name ||
                        'No department'}
                    </div>
                  )}

                  <div className="text-sm muted">
                    {new Date(
                      r.report_date
                    ).toLocaleDateString()}
                  </div>

                </div>

                <div className="flex items-center gap-2">

                  <span className="badge">
                    {statusText(
                      r.review_status
                    )}
                  </span>

                  {isSuper && (
                    <>

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
                        onClick={() =>
                          setDeleteReport(r)
                        }
                      >
                        Delete
                      </button>

                    </>
                  )}

                </div>

              </div>

              {/* REPORT DETAILS */}

              <div className="mt-4 grid gap-4 lg:grid-cols-2">

                <div>
                  <div className="label">
                    Completed
                  </div>

                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {r.completed_work}
                  </p>
                </div>

                <div>
                  <div className="label">
                    Tomorrow
                  </div>

                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {r.tomorrow_plan || '—'}
                  </p>
                </div>

                <div>
                  <div className="label">
                    Blockers
                  </div>

                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {r.blockers || 'None'}
                  </p>
                </div>

                <div>
                  <div className="label">
                    Hours Worked
                  </div>

                  <p className="mt-1 text-sm">
                    {r.hours_worked || '—'}
                  </p>
                </div>

              </div>

              {/* APPROVAL FLOW */}

              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs">
                <b>Approval flow:</b>{' '}
                Team Lead → Admin → Super Admin.
                A higher-level reviewer may approve
                directly and skip pending lower
                levels.
              </div>

              {/* REVIEW COMMENT */}

              {r.review_comment && (
                <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">
                  <b>
                    Latest review comment:
                  </b>{' '}
                  {r.review_comment}
                </div>
              )}

              {/* REVIEW BUTTONS */}

              {canReview(r) && (
                <div className="mt-4 flex flex-wrap gap-2">

                  <button
                    className="btn btn-accent"
                    onClick={() =>
                      openReview(
                        r,
                        'APPROVE'
                      )
                    }
                  >
                    Approve
                  </button>

                  <button
                    className="btn"
                    onClick={() =>
                      openReview(
                        r,
                        'NEEDS_CHANGES'
                      )
                    }
                  >
                    Needs Changes
                  </button>

                  <button
                    className="btn text-red-600"
                    onClick={() =>
                      openReview(
                        r,
                        'REJECT'
                      )
                    }
                  >
                    Reject
                  </button>

                </div>
              )}

            </div>
          ))}

        </div>
      ) : (
        !pageErr && <Empty />
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
