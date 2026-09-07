import { FormEvent, useEffect, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, Modal, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

const statuses = [
  'PENDING',
  'IN_PROGRESS',
  'BLOCKED',
  'SUBMITTED',
  'NEEDS_CHANGES',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];

export default function Tasks() {
  const { user } = useAuth();

  const isSuper = user?.role === 'SUPER_ADMIN';
  const canAssign = user?.role !== 'EMPLOYEE';

  const isReviewer =
    user?.role === 'ADMIN' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'TEAM_LEAD';

  const [rows, setRows] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [deps, setDeps] = useState<any[]>([]);

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const [showSubmit, setShowSubmit] = useState(false);
  const [submitTask, setSubmitTask] = useState<any | null>(null);

  const [showReview, setShowReview] = useState(false);
  const [reviewTask, setReviewTask] = useState<any | null>(null);

  const [reviewHistory, setReviewHistory] = useState<Record<number, any[]>>({});
  const [flippedTaskId, setFlippedTaskId] = useState<number | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<Record<number, string>>({});

  const [err, setErr] = useState('');
  const [pageErr, setPageErr] = useState('');

  const [assignmentType, setAssignmentType] =
    useState('INDIVIDUAL');

  const [filters, setFilters] = useState<any>({
    search: '',
    status: '',
    priority: '',
    department: '',
    employeeId: '',
    date: '',
  });

  /* =========================================================
     LOAD TASKS
  ========================================================= */

  async function load() {
    try {
      setPageErr('');

      const r = await api.get('/tasks', {
        params: filters,
      });

      setRows(r.data);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  useEffect(() => {
    void load();

    if (canAssign) {
      void api
        .get('/employees')
        .then((r) => setEmps(r.data))
        .catch((e) =>
          setPageErr(messageOf(e))
        );

      void api
        .get('/departments')
        .then((r) => setDeps(r.data))
        .catch(() => {});
    }
  }, []);

  /* =========================================================
     CREATE / EDIT TASK
  ========================================================= */

  async function save(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    setErr('');

    try {
      const fd = new FormData(e.currentTarget);

      const body: any =
        Object.fromEntries(fd.entries());

      body.assignmentType = assignmentType;

      if (assignmentType === 'MULTIPLE') {
        body.assignedToIds =
          fd.getAll('assignedToIds');
      }

      if (editing) {
        if (user?.role === 'EMPLOYEE') {
          // A NEEDS_CHANGES task returns to active work after the employee edits it.
          await api.put(`/tasks/${editing.id}`, {
            title: body.title,
            description: body.description,
            attachmentUrl: body.attachmentUrl,
            status: 'IN_PROGRESS',
            progress: 0,
          });
        } else {
          await api.put(
            `/tasks/${editing.id}/admin`,
            body
          );
        }
      } else {
        await api.post('/tasks', body);
      }

      setShow(false);
      setEditing(null);
      setAssignmentType('INDIVIDUAL');
      setErr('');

      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  /* =========================================================
     EMPLOYEE STATUS CHANGE
  ========================================================= */

  async function changeEmployeeStatus(
    id: number,
    status: string
  ) {
    try {
      let progress = 0;

      if (status === 'IN_PROGRESS') {
        progress = 50;
      }

      if (status === 'BLOCKED') {
        progress = 0;
      }

      await api.put(`/tasks/${id}`, {
        status,
        progress,
      });

      await load();
    } catch (e) {
      alert(messageOf(e));
    }
  }

  /* =========================================================
     MARK WORK COMPLETE
  ========================================================= */

  async function markWorkComplete(id: number) {
    try {
      await api.put(`/tasks/${id}`, {
        status: 'IN_PROGRESS',
        progress: 100,
      });

      await load();
    } catch (e) {
      alert(messageOf(e));
    }
  }

  /* =========================================================
     OPEN SUBMIT MODAL
  ========================================================= */

  function openSubmitModal(task: any) {
    setSubmitTask(task);
    setErr('');
    setShowSubmit(true);
  }

  /* =========================================================
     SUBMIT TASK FOR REVIEW
  ========================================================= */

  async function submitForReview(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    setErr('');

    if (!submitTask) return;

    try {
      const fd = new FormData(e.currentTarget);

      const completionSummary =
        String(
          fd.get('completionSummary') || ''
        ).trim();

      const proofUrl =
        String(
          fd.get('proofUrl') || ''
        ).trim();

      const proofType =
        submitTask.task_type === 'NON_TECHNICAL'
          ? 'GOOGLE_DRIVE'
          : 'GITHUB';

      if (!completionSummary) {
        setErr('Completion summary is required.');
        return;
      }

      if (!proofUrl) {
        setErr('Proof link is required.');
        return;
      }

      await api.post(`/tasks/${submitTask.id}/submit`, {
        completionSummary,
        proofType,
        proofUrl,
      });

      setShowSubmit(false);
      setSubmitTask(null);
      setErr('');

      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  /* =========================================================
     OPEN REVIEW MODAL
  ========================================================= */

  function openReviewModal(task: any) {
    setReviewTask(task);
    setErr('');
    setShowReview(true);
  }

  /* =========================================================
     REVIEW TASK
  ========================================================= */

  async function reviewSubmission(
    decision:
      | 'APPROVE'
      | 'NEEDS_CHANGES'
      | 'REJECT'
  ) {
    if (!reviewTask) return;

    const commentElement =
      document.getElementById(
        'review-comment'
      ) as HTMLTextAreaElement | null;

    const comment =
      commentElement?.value.trim() || '';

    if (
      (decision === 'NEEDS_CHANGES' ||
        decision === 'REJECT') &&
      !comment
    ) {
      setErr(
        'Please provide a reason for this decision.'
      );
      return;
    }

    try {
      await api.post(
        `/tasks/${reviewTask.id}/review`,
        {
          decision,
          comment,
        }
      );

      setShowReview(false);
      setReviewTask(null);
      setErr('');

      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

async function toggleReviewHistory(task: any) {
  const taskId = Number(task.id);

  // If already flipped, simply flip back.
  if (flippedTaskId === taskId) {
    setFlippedTaskId(null);
    return;
  }

  setHistoryLoadingId(taskId);
  setHistoryError((prev) => ({
    ...prev,
    [taskId]: '',
  }));

  try {
    // Load only once per task.
    if (!reviewHistory[taskId]) {
      const response = await api.get(
        `/tasks/${taskId}/review-history`
      );

      // The history endpoint may return either the array directly
      // or wrap it in a `history` / `rows` property. Normalize it
      // so the UI never crashes when calling .map().
      const data = response.data;
      const history = Array.isArray(data)
        ? data
        : Array.isArray(data?.history)
        ? data.history
        : Array.isArray(data?.rows)
        ? data.rows
        : [];

      setReviewHistory((prev) => ({
        ...prev,
        [taskId]: history,
      }));
    }

    setFlippedTaskId(taskId);
  } catch (e) {
    setHistoryError((prev) => ({
      ...prev,
      [taskId]: messageOf(e),
    }));
  } finally {
    setHistoryLoadingId(null);
  }
}


  /* =========================================================
     DELETE TASK
  ========================================================= */

  async function remove(id: number) {
    if (!confirm('Delete this task?')) return;

    try {
      await api.delete(`/tasks/${id}`);
      await load();
    } catch (e) {
      alert(messageOf(e));
    }
  }

  /* =========================================================
     REVIEW DISPLAY HELPERS
  ========================================================= */

  function reviewLabel(
    decision: string | null | undefined,
    reviewerName?: string | null
  ) {
    switch (decision) {
      case 'APPROVE':
      case 'APPROVED':
        return reviewerName
          ? `✓ Approved by ${reviewerName}`
          : '✓ Approved';

      case 'REJECT':
      case 'REJECTED':
        return reviewerName
          ? `✕ Rejected by ${reviewerName}`
          : '✕ Rejected';

      case 'NEEDS_CHANGES':
        return reviewerName
          ? `⚠ Changes requested by ${reviewerName}`
          : '⚠ Changes Requested';

      case 'SKIPPED':
        return '— Skipped';

      case 'PENDING':
      default:
        return '⏳ Pending Review';
    }
  }

  function reviewColor(
    decision: string | null | undefined
  ) {
    switch (decision) {
      case 'APPROVE':
      case 'APPROVED':
        return 'text-green-700';

      case 'REJECT':
      case 'REJECTED':
        return 'text-red-700';

      case 'NEEDS_CHANGES':
        return 'text-amber-700';

      default:
        return 'text-blue-700';
    }
  }

  function priorityClass(
    priority: string | null | undefined
  ) {
    switch (String(priority || '').toUpperCase()) {
      case 'LOW':
        return 'bg-green-100 text-green-800 border border-green-300';
      case 'MEDIUM':
        return 'bg-yellow-100 text-yellow-800 border border-yellow-300';
      case 'HIGH':
        return 'bg-orange-100 text-orange-800 border border-orange-300';
      case 'CRITICAL':
        return 'bg-red-100 text-red-800 border border-red-300';
      default:
        return 'bg-slate-100 text-slate-700 border border-slate-300';
    }
  }

  function priorityLabel(
    priority: string | null | undefined
  ) {
    switch (String(priority || '').toUpperCase()) {
      case 'LOW':
        return 'Routine';
      case 'MEDIUM':
        return 'Standard';
      case 'HIGH':
        return 'High Priority';
      case 'CRITICAL':
        return 'Urgent';
      default:
        return 'Standard';
    }
  }

  const teamLeads = emps.filter(
    (e) => e.role === 'TEAM_LEAD'
  );

  return (
    <>
      {/* =====================================================
          PAGE TITLE
      ====================================================== */}

      <PageTitle
        title="Task Management"
        subtitle="Individual, multiple-user, team and department task assignment"
        action={
          canAssign ? (
            <button
              className="btn btn-accent"
              onClick={() => {
                setEditing(null);
                setAssignmentType(
                  'INDIVIDUAL'
                );
                setErr('');
                setShow(true);
              }}
            >
              + Create Task
            </button>
          ) : undefined
        }
      />

      {/* =====================================================
          FILTERS
      ====================================================== */}

      <div className="card mb-5 grid gap-3 p-4 md:grid-cols-4">

        <input
          className="input md:col-span-2"
          placeholder="Search task or employee"
          value={filters.search}
          onChange={(e) =>
            setFilters({
              ...filters,
              search: e.target.value,
            })
          }
        />

        <select
          className="input"
          value={filters.status}
          onChange={(e) =>
            setFilters({
              ...filters,
              status: e.target.value,
            })
          }
        >
          <option value="">
            All status
          </option>

          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}

          <option value="OVERDUE">
            OVERDUE
          </option>
        </select>

        <select
          className="input"
          value={filters.priority}
          onChange={(e) =>
            setFilters({
              ...filters,
              priority: e.target.value,
            })
          }
        >
          <option value="">
            All priorities
          </option>

          <option value="LOW">
            LOW
          </option>

          <option value="MEDIUM">
            MEDIUM
          </option>

          <option value="HIGH">
            HIGH
          </option>

          <option value="CRITICAL">
            CRITICAL
          </option>
        </select>

        <select
          className="input"
          value={filters.department}
          onChange={(e) =>
            setFilters({
              ...filters,
              department: e.target.value,
            })
          }
        >
          <option value="">
            All departments
          </option>

          {deps.map((d) => (
            <option
              key={d.id}
              value={d.id}
            >
              {d.name}
            </option>
          ))}
        </select>

        <select
          className="input"
          value={filters.employeeId}
          onChange={(e) =>
            setFilters({
              ...filters,
              employeeId: e.target.value,
            })
          }
        >
          <option value="">
            All users
          </option>

          {emps.map((e) => (
            <option
              key={e.id}
              value={e.id}
            >
              {e.employee_code} —{' '}
              {e.first_name}{' '}
              {e.last_name}
            </option>
          ))}
        </select>

        <input
          className="input"
          type="date"
          value={filters.date}
          onChange={(e) =>
            setFilters({
              ...filters,
              date: e.target.value,
            })
          }
        />

        <button
          className="btn btn-primary"
          onClick={() => void load()}
        >
          Apply Filters
        </button>
      </div>

      {/* =====================================================
          PAGE ERROR
      ====================================================== */}

      {pageErr && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          {pageErr}
        </div>
      )}

      {/* =====================================================
          TASK LIST
      ====================================================== */}

      {rows.length ? (
        <div className="grid gap-4 xl:grid-cols-2">

          {rows.map((t) => {

            const isAssignedEmployee =
              t.assigned_to ===
              user?.employeeId;

            const isSubmitted =
              t.status === 'SUBMITTED' ||
              t.display_status ===
                'SUBMITTED';

            const isNeedsChanges =
              t.status ===
                'NEEDS_CHANGES' ||
              t.display_status ===
                'NEEDS_CHANGES';

            const rejectionReviewerName =
              t.hierarchy_review_status ===
              'REJECTED_BY_TEAM_LEAD'
                ? t.lead_reviewer_name
                : t.hierarchy_review_status ===
                  'REJECTED_BY_ADMIN'
                ? t.admin_reviewer_name
                : t.hierarchy_review_status ===
                  'REJECTED_BY_SUPER_ADMIN'
                ? t.super_admin_reviewer_name
                : null;

            const rejectionComment =
              t.hierarchy_review_status ===
              'REJECTED_BY_TEAM_LEAD'
                ? t.lead_review_comment
                : t.hierarchy_review_status ===
                  'REJECTED_BY_ADMIN'
                ? t.admin_review_comment
                : t.hierarchy_review_status ===
                  'REJECTED_BY_SUPER_ADMIN'
                ? t.super_admin_review_comment
                : t.reviewer_comment;

            /*
             * Employee can submit when:
             * - assigned to this employee
             * - progress is 100
             * - task is not already completed/submitted/rejected/cancelled
             */

            const canSubmit =
              isAssignedEmployee &&
              Number(t.progress) >= 100 &&
              ![
                'SUBMITTED',
                'COMPLETED',
                'REJECTED',
                'CANCELLED',
              ].includes(t.status);

            /*
             * Employee can mark work complete.
             */

            const canMarkWorkComplete =
              isAssignedEmployee &&
              t.status === 'IN_PROGRESS' &&
              Number(t.progress) < 100;

            /*
             * Current user's review state.
             *
             * This is deliberately NOT based only
             * on t.status === SUBMITTED.
             */

const canCurrentUserReview =
  isReviewer &&
  t.can_review === true &&
  t.status === 'SUBMITTED' &&
  t.display_status !== 'REJECTED' &&
  t.display_status !== 'NEEDS_CHANGES';

            /*
             * Final approval.
             */

            const superAdminApproved =
              t.super_admin_review_decision ===
                'APPROVE' ||
              t.super_admin_review_decision ===
                'APPROVED';

            return (
              <div
                className="relative"
                style={{ perspective: '1200px' }}
              >
                <div
                  className="relative transition-transform duration-500"
                  style={{
                    transformStyle: 'preserve-3d',
                    transform:
                      flippedTaskId === Number(t.id)
                        ? 'rotateY(180deg)'
                        : 'rotateY(0deg)',
                  }}
                >
                  <div
                    className={`card p-5 ${
                      t.display_status ===
                      'OVERDUE'
                        ? 'border-red-300'
                        : ''
                    }`}
                    key={t.id}
                    style={{ backfaceVisibility: 'hidden' }}
                  >

                {/* =================================================
                    TASK HEADER
                ================================================== */}

                
                  <div className="space-y-4">

                    {/* TOP ROW — STATUS + ACTION BUTTONS */}
                    <div className="flex flex-wrap items-center justify-between gap-3">

                      <span
                        className={`badge h-fit ${
                          t.display_status === 'OVERDUE'
                            ? '!bg-red-100 !text-red-700'
                            : ''
                        }`}
                      >
                        {t.display_status}
                      </span>

                      <div className="flex flex-wrap items-center gap-2">

                        {isAssignedEmployee && isNeedsChanges && (
                          <button
                            className="btn !bg-slate-600/15 !text-slate-700 !border !border-slate-300 hover:!bg-slate-600/25 !px-3 !py-1.5 whitespace-nowrap"
                            onClick={() => {
                              setEditing(t);
                              setErr('');
                              setShow(true);
                            }}
                          >
                            Edit Task
                          </button>
                        )}

                        <button
                          className="btn !bg-slate-700/15 !text-slate-800 !border !border-slate-300 hover:!bg-slate-700/25 !px-3 !py-1.5 whitespace-nowrap"
                          onClick={() => void toggleReviewHistory(t)}
                          disabled={
                            historyLoadingId === Number(t.id)
                          }
                        >
                          {historyLoadingId === Number(t.id)
                            ? 'Loading...'
                            : 'Task History'}
                        </button>

                        {isSuper && (
                          <>
                            <button
                              className="btn !bg-sky-700/15 !text-sky-800 !border !border-sky-300 hover:!bg-sky-700/25 !px-3 !py-1.5"
                              onClick={() => {
                                setEditing(t);
                                setErr('');
                                setShow(true);
                              }}
                            >
                              Edit
                            </button>

                            <button
                              className="btn !bg-rose-700/15 !text-rose-800 !border !border-rose-300 hover:!bg-rose-700/25 !px-3 !py-1.5 whitespace-nowrap"
                              onClick={() => remove(t.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}

                      </div>
                    </div>

                    {/* TASK ID + TITLE + ASSIGNEE BELOW BUTTONS */}
                    <div>
                      <div className="text-xs font-bold text-orange">
                        TASK #{t.id} • {t.employee_code}
                      </div>

                      <h3 className="mt-0.5 text-[18px] font-extrabold leading-6 text-navy">
                        {t.title}
                      </h3>

                      <p className="mt-1 text-sm leading-5 muted">
                        Assigned to {t.assignee_name} •{' '}
                        {t.department_name || 'No department'}
                      </p>
                    </div>

                  </div>

                {/* =================================================
                    DESCRIPTION
                ================================================== */}

                <p className="mt-4 text-sm leading-6 text-slate-700">
  {t.description ||
    'No description'}
</p>

                {/* =================================================
                    TASK DETAILS
                ================================================== */}

                <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">

                  <div className="min-w-0 leading-5">
                    <b>Uploaded By:</b>{' '}
                    {t.creator_name ||
                      'System'}
                  </div>

                 <div className="min-w-0 leading-5">
                    <b>Created:</b>{' '}
                    {new Date(
                      t.created_at
                    ).toLocaleString()}
                  </div>

                  <div className="min-w-0 leading-5">
                    <b>Start:</b>{' '}
                    {t.start_date
                      ? new Date(
                          t.start_date
                        ).toLocaleDateString()
                      : '—'}
                  </div>

                  <div className="min-w-0 leading-5">
                    <b>Deadline:</b>{' '}
                    {t.due_date
                      ? new Date(
                          t.due_date
                        ).toLocaleString()
                      : '—'}
                  </div>

                  <div className="min-w-0 leading-5">
                    <b>Scope:</b>{' '}
                    {t.assignment_scope}
                  </div>

                  <div className="min-w-0 leading-5">
                    <div className="flex items-center gap-2">
                      <b>Priority:</b>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${priorityClass(
                          t.priority
                        )}`}
                      >
                        {priorityLabel(t.priority)}
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0 leading-5">
                    <b>Type:</b>{' '}
                    {t.task_type ===
                    'NON_TECHNICAL'
                      ? 'Non-Technical'
                      : 'Technical'}
                  </div>

{t.display_status === 'REJECTED' ? (
  <div className="min-w-0 leading-5">
    <b>Final Verification:</b>{' '}
    <span>Rejected</span>
  </div>
) : t.completed_at ? (
  <div>
    <b>Final Verification:</b>{' '}
    {new Date(t.completed_at).toLocaleString()}
    {t.super_admin_reviewer_name
      ? ` • ${t.super_admin_reviewer_name}`
      : ''}
  </div>
) : (
  <div>
    <b>Final Verification:</b>{' '}
    <span className="muted">Pending</span>
  </div>
)}

                  {t.attachment_url && (
                    <div>
                      <a
                        className="text-orange underline"
                        href={
                          t.attachment_url
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open attachment/reference
                      </a>
                    </div>
                  )}

                </div>

                {/* =================================================
                    PROGRESS
                ================================================== */}

               <div className="mt-4 flex items-center justify-between text-sm"> 

                  <span className="font-semibold">
                    Progress
                  </span>

                  <span>
                    {Number(
                      t.progress || 0
                    )}
                    %
                  </span>

                </div>

                <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">

                  <div
                    className="h-full bg-orange transition-all"
                    style={{
                      width: `${Math.min(
                        Number(
                          t.progress || 0
                        ),
                        100
                      )}%`,
                    }}
                  />

                </div>

                {/* =================================================
                    SUBMITTED INFORMATION
                ================================================== */}

                {isSubmitted && (
                  <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">

                    <div className="font-bold">
                      ⏳ Task Submitted for Review
                    </div>

                    {t.completion_submitted_at && (
                      <div className="mt-1 text-xs">
                        Submitted:{' '}
                        {new Date(
                          t.completion_submitted_at
                        ).toLocaleString()}
                      </div>
                    )}

                    {t.proof_url && (
                      <a
                        className="mt-2 inline-block break-all text-blue-700 underline"
                        href={
                          t.proof_url
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Submitted Proof
                      </a>
                    )}

                  </div>
                )}

                {/* =================================================
                    REVIEW HIERARCHY
                ================================================== */}

                {t.completion_submission_id && (
                  <div className="mt-4 rounded-xl border bg-slate-50 p-4">

                    <div className="mb-3 text-sm font-extrabold text-navy">
                      Review Hierarchy
                    </div>

                    <div className="space-y-3">

                      {/* TEAM LEAD */}

                      <div className="grid grid-cols-[100px_1fr] items-center gap-3" >

                        <span className="text-[13px] font-semibold leading-5">
                          Team Lead
                        </span>

                        <span
                          className={`text-[13px] font-semibold leading-5 ${reviewColor(
                            t.lead_review_decision
                          )}`}
                        >
                          {reviewLabel(
                            t.lead_review_decision,
                            t.lead_reviewer_name
                          )}
                        </span>

                      </div>

                      {/* ADMIN */}

                      <div className="grid grid-cols-[100px_1fr] items-center gap-3" >

                        <span className="text-[13px] font-semibold leading-5">
                          Admin
                        </span>

                        <span
                          className={`text-[13px] font-semibold leading-5 ${reviewColor(
                            t.admin_review_decision
                          )}`}
                        >
                          {reviewLabel(
                            t.admin_review_decision,
                            t.admin_reviewer_name
                          )}
                        </span>

                      </div>

                      {/* SUPER ADMIN */}

                      <div className="grid grid-cols-[100px_1fr] items-center gap-3">

                        <span className="text-[13px] font-semibold leading-5">
                          Super Admin
                        </span>

                        <span
                          className={`text-[13px] font-semibold leading-5 ${reviewColor(
                            t.super_admin_review_decision
                          )}`}
                        >
                          {reviewLabel(
                            t.super_admin_review_decision,
                            t.super_admin_reviewer_name
                          )}
                        </span>

                      </div>

                    </div>

                    {/* NEXT REVIEWER */}

                    {t.next_reviewer_role && (
                      <div className="mt-4 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">

                        <b>
                          {t.next_reviewer_role ===
                          'TEAM_LEAD'
                            ? 'Team Lead'
                            : t.next_reviewer_role ===
                              'ADMIN'
                            ? 'Admin'
                            : 'Super Admin'}
                        </b>

                        {' '}approval pending.

                      </div>
                    )}

                    {/* FINAL SUPER ADMIN APPROVAL */}

                    {superAdminApproved && (
                      <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">
                        ✓ Approved by Super Admin
                      </div>
                    )}

                  </div>
                )}

                {/* =================================================
                    NEEDS CHANGES
                ================================================== */}

                {isNeedsChanges && (
                  <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">

                    <div className="font-bold">
                      ⚠ Changes Requested
                    </div>

                    {isAssignedEmployee && (
                      <div className="mt-1 font-semibold">
                        Edit the task, continue working, and resubmit it for review.
                      </div>
                    )}

                    {t.reviewer_comment && (
                      <div className="mt-1 whitespace-pre-wrap">
                        {t.reviewer_comment}
                      </div>
                    )}

                  </div>
                )}

                {/* =================================================
                    COMPLETED
                ================================================== */}

                {t.status ===
                  'COMPLETED' && (
                  <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">

                    <div className="font-bold">
                      ✓ Verified & Completed
                    </div>

                    {t.reviewer_comment && (
                      <div className="mt-1">
                        Reviewer:{' '}
                        {t.reviewer_comment}
                      </div>
                    )}

                  </div>
                )}

                {/* =================================================
                    REJECTED
                ================================================== */}

                {t.status ===
                  'REJECTED' && (
                  <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                    <div className="font-bold">
                      ✕ Task Rejected
                    </div>

                    {rejectionReviewerName && (
                      <div className="mt-1 font-semibold">
                        Rejected by {rejectionReviewerName}
                      </div>
                    )}

                    {rejectionComment && (
                      <div className="mt-1 whitespace-pre-wrap">
                        {rejectionComment}
                      </div>
                    )}
                  </div>
                )}

                {/* =================================================
                    EMPLOYEE CONTROLS
                ================================================== */}

                <div className="mt-4 flex flex-wrap items-center gap-2">

                  {isAssignedEmployee ? (
                    <>

                      {![
                        'SUBMITTED',
                        'COMPLETED',
                        'REJECTED',
                        'CANCELLED',
                      ].includes(
                        t.status
                      ) && (
                        <select
                          className="input max-w-52"
                          value={
                            t.status ===
                            'NEEDS_CHANGES'
                              ? 'IN_PROGRESS'
                              : t.status
                          }
                          onChange={(e) =>
                            changeEmployeeStatus(
                              t.id,
                              e.target.value
                            )
                          }
                        >

                          <option value="PENDING">
                            PENDING
                          </option>

                          <option value="IN_PROGRESS">
                            IN_PROGRESS
                          </option>

                          <option value="BLOCKED">
                            BLOCKED
                          </option>

                        </select>
                      )}

                      {canMarkWorkComplete && (
                        <button
                          className="btn btn-primary"
                          onClick={() =>
                            markWorkComplete(
                              t.id
                            )
                          }
                        >
                          Mark Work Complete
                        </button>
                      )}

                      {canSubmit && (
                        <button
                          className="btn btn-accent"
                          onClick={() =>
                            openSubmitModal(t)
                          }
                        >
                          Submit for Review
                        </button>
                      )}

                      {isSubmitted && (
                        <span className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                          Awaiting Review
                        </span>
                      )}

                      {t.status ===
                        'COMPLETED' && (
                        <span className="rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
                          ✓ Verified and Completed
                        </span>
                      )}

                    </>
                  ) : (
                    <span className="text-xs muted">
                      Progress:{' '}
                      {t.progress}%
                    </span>
                  )}

                  {/* =================================================
                      REVIEW BUTTON
                      
                      IMPORTANT:
                      The button is shown ONLY when the
                      CURRENT logged-in reviewer has a
                      PENDING review.
                  ================================================== */}

                  {canCurrentUserReview && (
                    <button
                      className="btn btn-accent"
                      onClick={() =>
                        openReviewModal(t)
                      }
                    >
                      Review
                    </button>
                  )}

                </div>
                </div>
                {/* END FRONT CARD */}

                <div
                  className="card absolute inset-0 overflow-hidden p-5"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs font-bold text-orange">
                          TASK #{t.id}
                        </div>
                        <h3 className="font-extrabold text-navy">
                          Task History
                        </h3>
                      </div>

                      <button
                        className="btn !px-3 !py-1.5"
                        onClick={() => setFlippedTaskId(null)}
                      >
                        ← Back
                      </button>
                    </div>

                    <div className="mt-4 flex-1 overflow-y-auto pr-1">
                      {historyError[Number(t.id)] && (
                        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                          {historyError[Number(t.id)]}
                        </div>
                      )}

                      {!historyError[Number(t.id)] &&
                        !reviewHistory[Number(t.id)]?.length && (
                          <div className="rounded-lg bg-slate-50 p-4 text-sm muted">
                            No history found.
                          </div>
                        )}

                      <div className="relative space-y-3">
                        {(Array.isArray(
                          reviewHistory[Number(t.id)]
                        )
                          ? reviewHistory[Number(t.id)]
                          : []
                        ).map((history: any) => {
                          const eventType =
                            String(history.event_type || '').toUpperCase();

                          const roleLabel =
                            history.actor_role === 'TEAM_LEAD'
                              ? 'Team Lead'
                              : history.actor_role === 'SUPER_ADMIN'
                              ? 'Super Admin'
                              : history.actor_role === 'ADMIN'
                              ? 'Admin'
                              : history.actor_role === 'EMPLOYEE'
                              ? 'Employee'
                              : history.actor_role || 'System';

                          const decision =
                            String(history.decision || '').toUpperCase();

                          let title = 'History Event';
                          let icon = '•';
                          let boxClass = 'rounded-xl border bg-slate-50 p-4';
                          let titleClass = 'font-bold text-slate-800';

                          if (eventType === 'TASK_CREATED') {
                            title = 'Task Created';
                            icon = '📋';
                            boxClass = 'rounded-xl border bg-slate-50 p-4';
                          } else if (eventType === 'SUBMISSION') {
                            title =
                              Number(history.submission_number || 1) > 1
                                ? 'Task Resubmitted'
                                : 'Task Submitted';
                            icon = '📤';
                            boxClass = 'rounded-xl border bg-blue-50 p-4';
                            titleClass = 'font-bold text-blue-800';
                          } else if (eventType === 'REVIEW') {
                            if (
                              decision === 'APPROVED' ||
                              decision === 'APPROVE'
                            ) {
                              title = `${roleLabel} Approved`;
                              icon = '✓';
                              boxClass =
                                'rounded-xl border bg-green-50 p-4';
                              titleClass = 'font-bold text-green-800';
                            } else if (
                              decision === 'NEEDS_CHANGES'
                            ) {
                              title = `${roleLabel} Requested Changes`;
                              icon = '⚠';
                              boxClass =
                                'rounded-xl border bg-amber-50 p-4';
                              titleClass = 'font-bold text-amber-800';
                            } else if (
                              decision === 'REJECTED' ||
                              decision === 'REJECT'
                            ) {
                              title = `${roleLabel} Rejected`;
                              icon = '✕';
                              boxClass =
                                'rounded-xl border bg-red-50 p-4';
                              titleClass = 'font-bold text-red-800';
                            } else if (decision === 'SKIPPED') {
                              title = `${roleLabel} Review Skipped`;
                              icon = '—';
                              boxClass =
                                'rounded-xl border bg-slate-50 p-4';
                            } else {
                              title = `${roleLabel} Review`;
                              icon = '⏳';
                            }
                          } else if (
                            eventType === 'STATUS_CHANGED'
                          ) {
                            title = 'Status Changed';
                            icon = '↻';
                          }

                          return (
                            <div
                              key={`${eventType}-${history.review_id || history.submission_id || history.sequence}`}
                              className={boxClass}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className={titleClass}>
                                  {icon} {title}
                                </div>

                                {history.event_at && (
                                  <div className="text-xs muted">
                                    {new Date(
                                      history.event_at
                                    ).toLocaleString()}
                                  </div>
                                )}
                              </div>

                              <div className="mt-2 text-sm">
                                <b>By:</b> {history.actor_name || 'System'}
                              </div>

                              {eventType === 'REVIEW' && (
                                <div className="mt-1 text-sm">
                                  <b>Role:</b> {roleLabel}
                                </div>
                              )}

                              {eventType === 'REVIEW' && decision && (
                                <div className="mt-1 text-sm">
                                  <b>Decision:</b>{' '}
                                  {decision === 'APPROVE' ||
                                  decision === 'APPROVED'
                                    ? 'Approved'
                                    : decision === 'NEEDS_CHANGES'
                                    ? 'Changes Requested'
                                    : decision === 'REJECT' ||
                                      decision === 'REJECTED'
                                    ? 'Rejected'
                                    : decision === 'SKIPPED'
                                    ? 'Skipped'
                                    : decision}
                                </div>
                              )}

                              {eventType === 'STATUS_CHANGED' && (
                                <div className="mt-1 text-sm">
                                  <b>Status:</b>{' '}
                                  {history.old_status || '—'} →{' '}
                                  {history.new_status || '—'}
                                </div>
                              )}

                              {eventType === 'SUBMISSION' &&
                                history.submission_id && (
                                  <div className="mt-1 text-sm">
                                    <b>Submission:</b> #
                                    {history.submission_number || 1}
                                  </div>
                                )}

                              {history.comment && (
                                <div className="mt-2 whitespace-pre-wrap text-sm">
                                  <b>
                                    {eventType === 'REVIEW'
                                      ? decision === 'NEEDS_CHANGES'
                                        ? 'Reason:'
                                        : 'Comment:'
                                      : 'Details:'}
                                  </b>{' '}
                                  {history.comment}
                                </div>
                              )}

                              {history.completion_summary && (
                                <div className="mt-2 whitespace-pre-wrap text-sm">
                                  <b>Completion Summary:</b>{' '}
                                  {history.completion_summary}
                                </div>
                              )}

                              {history.proof_url && (
                                <a
                                  className="mt-2 inline-block break-all text-blue-700 underline"
                                  href={history.proof_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Open Submitted Proof
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {t.completed_at && (
                        <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
                          <div className="font-bold text-green-800">
                            ✓ Final Verification
                          </div>
                          <div className="mt-1 text-sm text-green-800">
                            Super Admin final approval recorded at{' '}
                            {new Date(
                              t.completed_at
                            ).toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* END ROTATING CARD */}
                </div>
              </div>
            );
          })}

        </div>
      ) : (
        !pageErr && <Empty />
      )}

      {/* =========================================================
          CREATE / EDIT TASK MODAL
      ========================================================= */}

      {show && (
        <Modal
          title={
            editing
              ? user?.role === 'EMPLOYEE'
                ? 'Edit Task & Continue Work'
                : 'Edit Task'
              : 'Create Task'
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

            <input
              name="title"
              className="input"
              placeholder="Task title"
              defaultValue={
                editing?.title || ''
              }
              required
            />

            <textarea
              name="description"
              className="input min-h-24"
              placeholder="Task description"
              defaultValue={
                editing?.description || ''
              }
            />

            {!editing && (
              <>
                {/* TASK TYPE */}

                <div>
                  <label className="label">
                    Task Type
                  </label>

                  <select
                    name="taskType"
                    className="input mt-1"
                    defaultValue="TECHNICAL"
                  >
                    <option value="TECHNICAL">
                      Technical — GitHub proof
                    </option>

                    <option value="NON_TECHNICAL">
                      Non-Technical — Google Drive proof
                    </option>
                  </select>
                </div>

                {/* ASSIGNMENT TYPE */}

                <div>
                  <label className="label">
                    Assignment Type
                  </label>

                  <select
                    className="input mt-1"
                    value={
                      assignmentType
                    }
                    onChange={(e) =>
                      setAssignmentType(
                        e.target.value
                      )
                    }
                  >
                    <option value="INDIVIDUAL">
                      Individual employee/intern
                    </option>

                    <option value="MULTIPLE">
                      Multiple employees/interns
                    </option>

                    <option value="TEAM">
                      Entire team
                    </option>

                    {user?.role !==
                      'TEAM_LEAD' && (
                      <option value="DEPARTMENT">
                        Department
                      </option>
                    )}
                  </select>
                </div>

                {/* INDIVIDUAL */}

                {assignmentType ===
                  'INDIVIDUAL' && (
                  <select
                    name="assignedTo"
                    className="input"
                    required
                  >
                    <option value="">
                      Select user
                    </option>

                    {emps.map((e) => (
                      <option
                        key={e.id}
                        value={e.id}
                      >
                        {e.employee_code} —{' '}
                        {e.first_name}{' '}
                        {e.last_name}
                      </option>
                    ))}
                  </select>
                )}

                {/* MULTIPLE */}

                {assignmentType ===
                  'MULTIPLE' && (
                  <div>
                    <label className="label">
                      Select multiple users
                      (Ctrl/Cmd + click)
                    </label>

                    <select
                      multiple
                      name="assignedToIds"
                      className="input mt-1 min-h-36"
                      required
                    >
                      {emps.map((e) => (
                        <option
                          key={e.id}
                          value={e.id}
                        >
                          {e.employee_code} —{' '}
                          {e.first_name}{' '}
                          {e.last_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* TEAM */}

                {assignmentType ===
                  'TEAM' &&
                  user?.role !==
                    'TEAM_LEAD' && (
                  <select
                    name="teamLeadId"
                    className="input"
                    required
                  >
                    <option value="">
                      Select team / Team Lead
                    </option>

                    {teamLeads.map((e) => (
                      <option
                        key={e.id}
                        value={e.id}
                      >
                        {e.employee_code} —{' '}
                        {e.first_name}{' '}
                        {e.last_name}
                      </option>
                    ))}
                  </select>
                )}

                {assignmentType ===
                  'TEAM' &&
                  user?.role ===
                    'TEAM_LEAD' && (
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    This task will be assigned
                    to all current members under
                    your supervision.
                  </div>
                )}

                {/* DEPARTMENT */}

                {assignmentType ===
                  'DEPARTMENT' && (
                  <select
                    name="departmentId"
                    className="input"
                    required
                  >
                    <option value="">
                      Select department
                    </option>

                    {deps.map((d) => (
                      <option
                        key={d.id}
                        value={d.id}
                      >
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}

                <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  Existing team tasks are not
                  automatically given to employees
                  who join the team later. Assign
                  them separately if needed.
                </div>
              </>
            )}

            {/* EDITING */}

            {editing && user?.role !== 'EMPLOYEE' && (
              <>
                <select
                  name="assignedTo"
                  className="input"
                  defaultValue={
                    editing.assigned_to
                  }
                >
                  {emps.map((e) => (
                    <option
                      key={e.id}
                      value={e.id}
                    >
                      {e.employee_code} —{' '}
                      {e.first_name}{' '}
                      {e.last_name}
                    </option>
                  ))}
                </select>

                <div>
                  <label className="label">
                    Task Type
                  </label>

                  <select
                    name="taskType"
                    className="input mt-1"
                    defaultValue={
                      editing.task_type ||
                      'TECHNICAL'
                    }
                  >
                    <option value="TECHNICAL">
                      Technical — GitHub proof
                    </option>

                    <option value="NON_TECHNICAL">
                      Non-Technical — Google Drive proof
                    </option>
                  </select>
                </div>
              </>
            )}

            {/* PRIORITY / DATES */}

            {user?.role !== 'EMPLOYEE' && (
              <div className="grid gap-4 sm:grid-cols-2">

              <div>
                <label className="label">
                  Priority Level
                </label>

                <select
                  name="priority"
                  className="input mt-1"
                  defaultValue={
                    editing?.priority ||
                    'MEDIUM'
                  }
                >
                  <option value="LOW">Routine</option>
                  <option value="MEDIUM">Standard</option>
                  <option value="HIGH">High Priority</option>
                  <option value="CRITICAL">Urgent</option>
                </select>
              </div>

              <div>
                <label className="label">
                  Start Date
                </label>

                <input
                  name="startDate"
                  className="input mt-1"
                  type="date"
                  defaultValue={
                    editing?.start_date?.slice?.(
                      0,
                      10
                    ) || ''
                  }
                />
              </div>

              <div>
                <label className="label">
                  End Date
                </label>

                <input
                  name="dueDate"
                  className="input mt-1"
                  type="datetime-local"
                  defaultValue={
                    editing?.due_date
                      ? new Date(
                          editing.due_date
                        )
                          .toISOString()
                          .slice(0, 16)
                      : ''
                  }
                />
              </div>

              <input
                name="attachmentUrl"
                className="input"
                placeholder="Attachment URL / reference (optional)"
                defaultValue={
                  editing?.attachment_url ||
                  ''
                }
              />

              </div>
            )}

            {/* ADMIN EDIT STATUS */}

            {editing && user?.role !== 'EMPLOYEE' && (
              <div className="grid gap-4 sm:grid-cols-2">

                <select
                  name="status"
                  className="input"
                  defaultValue={
                    editing.status
                  }
                >
                  {statuses.map((s) => (
                    <option
                      key={s}
                      value={s}
                    >
                      {s}
                    </option>
                  ))}
                </select>

                <input
                  name="progress"
                  className="input"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue={
                    editing.progress
                  }
                />

              </div>
            )}

            {err && (
              <div className="text-red-600">
                {err}
              </div>
            )}

            <button className="btn btn-primary">
              {editing
                ? user?.role === 'EMPLOYEE'
                  ? 'Save & Continue Work'
                  : 'Save Changes'
                : 'Create & Notify'}
            </button>

          </form>
        </Modal>
      )}

      {/* =========================================================
          SUBMIT FOR REVIEW MODAL
      ========================================================= */}

      {showSubmit &&
        submitTask && (
          <Modal
            title="Submit Task for Review"
            onClose={() => {
              setShowSubmit(false);
              setSubmitTask(null);
              setErr('');
            }}
          >

            <form
              onSubmit={
                submitForReview
              }
              className="space-y-4"
            >

              <div className="rounded-lg bg-slate-50 p-4">

                <div className="text-xs font-bold text-orange">
                  TASK #{submitTask.id}
                </div>

                <div className="mt-1 font-bold text-navy">
                  {submitTask.title}
                </div>

                <div className="mt-1 text-xs muted">
                  Progress:{' '}
                  {submitTask.progress}%
                </div>

              </div>

              <div>
                <label className="label">
                  Completion Summary *
                </label>

                <textarea
                  name="completionSummary"
                  className="input mt-1 min-h-32"
                  placeholder="Describe what you completed..."
                  required
                />
              </div>

              <div>
                <label className="label">
                  Proof / Evidence *
                </label>

                <div className="mb-2 rounded-lg bg-slate-50 p-3 text-sm">

                  {submitTask.task_type ===
                  'NON_TECHNICAL' ? (
                    <>
                      <b>
                        Google Drive
                      </b>

                      <div className="mt-1 text-xs muted">
                        Upload your completed
                        work to Google Drive and
                        paste the shareable link
                        below.
                      </div>
                    </>
                  ) : (
                    <>
                      <b>
                        GitHub
                      </b>

                      <div className="mt-1 text-xs muted">
                        Provide the GitHub
                        repository, commit or
                        pull request containing
                        your completed work.
                      </div>
                    </>
                  )}

                </div>

                <input
                  name="proofUrl"
                  className="input"
                  type="url"
                  placeholder={
                    submitTask.task_type === 'NON_TECHNICAL'
                      ? 'https://drive.google.com/...'
                      : 'https://github.com/...'
                  }
                  required
                />

                <div className="mt-1 text-xs muted">
                  {submitTask.task_type === 'NON_TECHNICAL'
                    ? 'Paste a shareable Google Drive or Google Docs link.'
                    : 'Paste a GitHub repository, commit, or pull request link.'}
                </div>

              </div>

              <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                Your task will be sent through the Team Lead → Admin → Super Admin review hierarchy. A higher-level reviewer may act directly and skip pending lower levels. Employees cannot mark the task COMPLETED themselves.
              </div>

              {err && (
                <div className="text-red-600">
                  {err}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary w-full"
              >
                Submit for Review
              </button>

            </form>

          </Modal>
        )}

      {/* =========================================================
          REVIEW MODAL
      ========================================================= */}

      {showReview &&
        reviewTask && (
          <Modal
            title="Review Task Completion"
            onClose={() => {
              setShowReview(false);
              setReviewTask(null);
              setErr('');
            }}
          >

            <div className="space-y-4">

              {/* TASK */}

              <div className="rounded-lg bg-slate-50 p-4">

                <div className="text-xs font-bold text-orange">
                  TASK #{reviewTask.id}
                </div>

                <h3 className="mt-1 font-extrabold text-navy">
                  {reviewTask.title}
                </h3>

               <p className="mt-1 text-sm leading-5 muted">
                  Employee:{' '}
                  {reviewTask.assignee_name}
                </p>

              </div>

              {/* REVIEW HIERARCHY IN MODAL */}

              <div className="rounded-lg border bg-slate-50 p-4">

                <div className="mb-3 text-sm font-bold">
                  Current Review Status
                </div>

                <div className="space-y-2 text-sm">

                  <div className="flex justify-between gap-3">
                    <span>
                      Team Lead
                    </span>

                    <span
                      className={reviewColor(
                        reviewTask.lead_review_decision
                      )}
                    >
                      {reviewLabel(
                        reviewTask.lead_review_decision,
                        reviewTask.lead_reviewer_name
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>
                      Admin
                    </span>

                    <span
                      className={reviewColor(
                        reviewTask.admin_review_decision
                      )}
                    >
                      {reviewLabel(
                        reviewTask.admin_review_decision,
                        reviewTask.admin_reviewer_name
                      )}
                    </span>
                  </div>

                  <div className="flex justify-between gap-3">
                    <span>
                      Super Admin
                    </span>

                    <span
                      className={reviewColor(
                        reviewTask.super_admin_review_decision
                      )}
                    >
                      {reviewLabel(
                        reviewTask.super_admin_review_decision,
                        reviewTask.super_admin_reviewer_name
                      )}
                    </span>
                  </div>

                </div>

              </div>

              {/* SUMMARY */}

              <div>

                <div className="mb-1 text-sm font-bold">
                  Completion Summary
                </div>

                <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap">
                  {reviewTask.completion_summary ||
                    'No completion summary available.'}
                </div>

              </div>

              {/* PROOF */}

              <div>

                <div className="mb-1 text-sm font-bold">
                  Proof / Evidence
                </div>

                <div className="rounded-lg border p-3">

                  <div className="text-xs muted">
                    {reviewTask.task_type ===
                    'NON_TECHNICAL'
                      ? 'Google Drive'
                      : 'GitHub'}
                  </div>

                  {reviewTask.proof_url && (
                    <a className="mt-2 block break-all text-orange underline" href={reviewTask.proof_url} target="_blank" rel="noreferrer">Open Submitted Proof Link</a>
                  )}
                  {reviewTask.proof_file_path && (
                    <a className="mt-2 block break-all text-orange underline" href={`${String(api.defaults.baseURL||'').replace(/\/api\/?$/,'')}${reviewTask.proof_file_path}`} target="_blank" rel="noreferrer">Open Uploaded Proof{reviewTask.proof_file_name?` (${reviewTask.proof_file_name})`:''}</a>
                  )}
                  {!reviewTask.proof_url && !reviewTask.proof_file_path && (
                    <div className="mt-1 text-sm text-red-600">No proof evidence submitted.</div>
                  )}

                </div>

              </div>

              {/* SUBMISSION TIME */}

              {reviewTask.completion_submitted_at && (
                <div className="text-xs muted">
                  Submitted:{' '}
                  {new Date(
                    reviewTask.completion_submitted_at
                  ).toLocaleString()}
                </div>
              )}

              {/* COMMENT */}

              <div>

                <label className="label">
                  Reviewer Comment
                </label>

                <textarea
                  id="review-comment"
                  className="input mt-1 min-h-28"
                  placeholder="Add your review or feedback..."
                />

              </div>

              {err && (
                <div className="text-red-600">
                  {err}
                </div>
              )}

              {/* DECISIONS */}

              <div className="grid gap-2 sm:grid-cols-3">

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    reviewSubmission(
                      'APPROVE'
                    )
                  }
                >
                  ✓ Approve
                </button>

                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    reviewSubmission(
                      'NEEDS_CHANGES'
                    )
                  }
                >
                  Needs Changes
                </button>

                <button
                  type="button"
                  className="btn text-red-600"
                  onClick={() =>
                    reviewSubmission(
                      'REJECT'
                    )
                  }
                >
                  Reject
                </button>

              </div>

            </div>

          </Modal>
        )}

    </>
  );
}
