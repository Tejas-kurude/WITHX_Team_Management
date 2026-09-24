import { FormEvent, useEffect, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, Modal, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';
import { CheckCircle2, Clock } from 'lucide-react';

function toDateTimeLocal(value: any) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDateTimeToIso(value: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString();
}

function mergeTaskUpdate(current: any, updated: any) {
  const merged = { ...current, ...updated, is_edited: current?.is_edited || true };
  const status = String(merged.status || '').toUpperCase();
  const overdue =
    !!merged.due_date &&
    new Date(merged.due_date).getTime() < Date.now() &&
    !['COMPLETED', 'CANCELLED'].includes(status);
  merged.display_status =
    status === 'REJECTED'
      ? 'REJECTED'
      : status === 'NEEDS_CHANGES'
      ? 'NEEDS_CHANGES'
      : overdue
      ? 'OVERDUE'
      : merged.status;
  return merged;
}


const statuses = [
  'DRAFT',
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

  const [taskTab, setTaskTab] = useState<'active' | 'past'>('active');

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [publishDraftMode, setPublishDraftMode] = useState(false);
  const [deleteTask, setDeleteTask] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<any | null>(null);

  const [showSubmit, setShowSubmit] = useState(false);
  const [submitTask, setSubmitTask] = useState<any | null>(null);

  const [showReview, setShowReview] = useState(false);
  const [reviewTask, setReviewTask] = useState<any | null>(null);

  const [reviewHistory, setReviewHistory] = useState<Record<number, any[]>>({});
  const [flippedTaskId, setFlippedTaskId] = useState<number | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<Record<number, string>>({});

  const [editDetails, setEditDetails] = useState<any | null>(null);
  const [seenEditedAt, setSeenEditedAt] = useState<Record<number, string | null>>({});

  function markEditedTaskSeen(task: any) {
    const taskId = Number(task.id);
    setSeenEditedAt((prev) => ({
      ...prev,
      [taskId]: task.latest_edit_at || null,
    }));
  }

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

  const [showAdminTasks, setShowAdminTasks] =
    useState(false);

  const [showDrafts, setShowDrafts] =
    useState(false);

  const [teamView, setTeamView] =
    useState<'none' | 'list' | 'tasks'>('none');
  const [selectedTeamLead, setSelectedTeamLead] =
    useState<any | null>(null);

  /* =========================================================
     LOAD TASKS
  ========================================================= */

  async function load(adminOnly = showAdminTasks, tab = taskTab, drafts = showDrafts) {
    try {
      setPageErr('');

      const params: any = {
        ...filters,
        statusGroup: drafts ? undefined : tab,
      };
      if (drafts) {
        params.status = 'DRAFT';
      }

      const r = await api.get('/tasks', {
        params,
      });

      const taskRows = Array.isArray(r.data)
        ? r.data
        : [];

      const visibleRows = adminOnly
        ? taskRows.filter((task: any) => {
            const adminEmployeeIds = new Set(
              emps
                .filter((e) => e.role === 'ADMIN')
                .map((e) => Number(e.id))
            );
            return adminEmployeeIds.has(Number(task.assigned_to));
          })
        : taskRows;

      setRows(visibleRows);

      // Keep the open task-details modal synchronized with the latest
      // server response after status/submission/review changes.
      if (selectedTask) {
        const refreshedTask = visibleRows.find(
          (task: any) => Number(task.id) === Number(selectedTask.id)
        );
        if (refreshedTask) {
          setSelectedTask(refreshedTask);
        }
      }
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

  async function openTeamTasks(teamLead: any) {
    try {
      setPageErr('');
      setSelectedTeamLead(teamLead);
      setTeamView('tasks');
      setShowAdminTasks(false);

      const nextFilters = {
        ...filters,
        employeeId: '',
        teamLeadId: teamLead.id,
      };

      setFilters(nextFilters);

      const r = await api.get('/tasks', {
        params: nextFilters,
      });

      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  async function openTeams() {
    // Clicking Teams while already in the Teams view toggles back to
    // the normal default task view.
    if (teamView !== 'none') {
      setTeamView('none');
      setSelectedTeamLead(null);
      setShowAdminTasks(false);
      setFilters((prev: any) => ({
        ...prev,
        teamLeadId: '',
        employeeId: '',
      }));

      try {
        setPageErr('');
        const nextFilters = {
          ...filters,
          teamLeadId: '',
          employeeId: '',
        };
        const r = await api.get('/tasks', {
          params: nextFilters,
        });
        setRows(Array.isArray(r.data) ? r.data : []);
      } catch (e) {
        setPageErr(messageOf(e));
      }
      return;
    }

    setShowAdminTasks(false);
    setSelectedTeamLead(null);
    setTeamView('list');
    setRows([]);
    setFilters((prev: any) => ({
      ...prev,
      teamLeadId: '',
      employeeId: '',
    }));
    setPageErr('');
  }

  async function toggleAdminTasks() {
    // Clicking Admin while already active toggles back to the normal task view.
    if (showAdminTasks) {
      setShowAdminTasks(false);
      setTeamView('none');
      setSelectedTeamLead(null);
      setFilters((prev: any) => ({
        ...prev,
        teamLeadId: '',
        employeeId: '',
      }));

      try {
        setPageErr('');
        const nextFilters = {
          ...filters,
          teamLeadId: '',
          employeeId: '',
        };
        const r = await api.get('/tasks', {
          params: nextFilters,
        });
        setRows(Array.isArray(r.data) ? r.data : []);
      } catch (e) {
        setPageErr(messageOf(e));
      }
      return;
    }

    setShowAdminTasks(true);
    setTeamView('none');
    setSelectedTeamLead(null);

    const nextFilters = {
      ...filters,
      teamLeadId: '',
      employeeId: '',
    };

    setFilters(nextFilters);

    try {
      setPageErr('');
      const r = await api.get('/tasks', {
        params: nextFilters,
      });
      const taskRows = Array.isArray(r.data)
        ? r.data
        : [];
      const adminEmployeeIds = new Set(
        emps
          .filter((e) => e.role === 'ADMIN')
          .map((e) => Number(e.id))
      );

      setRows(
        taskRows.filter((task: any) =>
          adminEmployeeIds.has(Number(task.assigned_to))
        )
      );
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  async function toggleDrafts() {
    const nextActive = !showDrafts;
    setShowDrafts(nextActive);
    setShowAdminTasks(false);
    setTeamView('none');
    setSelectedTeamLead(null);
    const nextFilters = {
      ...filters,
      status: nextActive ? 'DRAFT' : '',
      teamLeadId: '',
      employeeId: '',
    };
    setFilters(nextFilters);
    try {
      setPageErr('');
      const r = await api.get('/tasks', { params: nextFilters });
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  function backToTeams() {
    setSelectedTeamLead(null);
    setTeamView('list');
    setRows([]);
    setFilters((prev: any) => ({
      ...prev,
      teamLeadId: '',
      employeeId: '',
    }));
    setPageErr('');
  }

  /* =========================================================
     CREATE / EDIT TASK
  ========================================================= */

  async function save(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    setErr('');
    setCreatingTask(false);

    try {
      const form = e.currentTarget;
      const fd = new FormData(form);
      const submitter = (e.nativeEvent as SubmitEvent).submitter as
        | HTMLButtonElement
        | HTMLInputElement
        | null;
      const saveMode = String(
        submitter?.value || fd.get('saveMode') || ''
      ).toUpperCase();
      const body: any =
        Object.fromEntries(fd.entries());
      const saveAsDraft = saveMode === 'DRAFT';
      const editingDraft =
        !!editing &&
        String(editing.status || '').toUpperCase() === 'DRAFT';
      const publishDraft = editingDraft && saveMode === 'PUBLISH';
      if (publishDraft) {
        body.status = 'PENDING';
      }
      const resultingStatus = String(
        body.status || (editingDraft ? 'DRAFT' : '')
      ).toUpperCase();
      const remainsDraft =
        editingDraft && resultingStatus === 'DRAFT';
      body.saveAsDraft = saveAsDraft;

      body.assignmentType = assignmentType;

      if (!saveAsDraft && !remainsDraft) {
        if (!String(body.title || '').trim()) {
          setErr('Task title is required.');
          return;
        }

        const assignmentValue = String(body.assignedTo || '').trim();
        const multipleIds = fd.getAll('assignedToIds').map(String).filter(Boolean);
        if (assignmentType === 'INDIVIDUAL' && !assignmentValue) {
          setErr('Select a user for this task.');
          return;
        }
        if (assignmentType === 'MULTIPLE' && !multipleIds.length) {
          setErr('Select at least one user for this task.');
          return;
        }
        if (assignmentType === 'TEAM' && user?.role !== 'TEAM_LEAD' && !String(body.teamLeadId || '').trim()) {
          setErr('Select a team/Team Lead.');
          return;
        }
        if (assignmentType === 'DEPARTMENT' && !String(body.departmentId || '').trim()) {
          setErr('Select a department.');
          return;
        }
        if (assignmentType === 'ADMIN' && !assignmentValue) {
          setErr('Select an Admin.');
          return;
        }
      }

      if (assignmentType === 'MULTIPLE') {
        body.assignedToIds =
          fd.getAll('assignedToIds');
      }

      let updatedTask: any = null;

      if (editing) {
        if (body.startDate) body.startDate = localDateTimeToIso(String(body.startDate));
        if (body.dueDate) body.dueDate = localDateTimeToIso(String(body.dueDate));

        if (user?.role === 'EMPLOYEE') {
          // A NEEDS_CHANGES task returns to active work after the employee edits it.
          const response = await api.put(`/tasks/${editing.id}`, {
            title: body.title,
            description: body.description,
            attachmentUrl: body.attachmentUrl,
            status: 'IN_PROGRESS',
            progress: 0,
          });
          updatedTask = response.data;
        } else {
          const response = await api.put(
            `/tasks/${editing.id}/admin`,
            body
          );
          updatedTask = response.data;
        }

        if (updatedTask) {
          setRows((prev) =>
            prev.map((task) =>
              Number(task.id) === Number(editing.id)
                ? mergeTaskUpdate(task, updatedTask)
                : task
            )
          );
          setSelectedTask((prev: any) =>
            prev && Number(prev.id) === Number(editing.id)
              ? mergeTaskUpdate(prev, updatedTask)
              : prev
          );
        }

        // An edit creates a new task_edit_history row on the server.
        // Drop the cached history so the next "Task History" click
        // always fetches the newly recorded edit event.
        setReviewHistory((prev) => {
          const next = { ...prev };
          delete next[Number(editing.id)];
          return next;
        });
      } else {
        setCreatingTask(true);
        try {
          await api.post('/tasks', body);
        } finally {
          setCreatingTask(false);
        }
      }

      setShow(false);
      setEditing(null);
      setPublishDraftMode(false);
      setAssignmentType('INDIVIDUAL');
      setErr('');

      const nextFilters = {
        ...filters,
        status: saveAsDraft || remainsDraft ? 'DRAFT' : '',
        teamLeadId: '',
        employeeId: '',
      };
      setShowDrafts(saveAsDraft || remainsDraft);
      setFilters(nextFilters);
      const refreshed = await api.get('/tasks', { params: nextFilters });
      setRows(Array.isArray(refreshed.data) ? refreshed.data : []);
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

      const response = await api.put(`/tasks/${id}`, {
        status,
        progress,
      });

      if (response.data) {
        setRows((prev) =>
          prev.map((task) =>
            Number(task.id) === Number(id)
              ? mergeTaskUpdate(task, response.data)
              : task
          )
        );
        setSelectedTask((prev: any) =>
          prev && Number(prev.id) === Number(id)
            ? mergeTaskUpdate(prev, response.data)
            : prev
        );
      }

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
      const response = await api.put(`/tasks/${id}`, {
        status: 'IN_PROGRESS',
        progress: 100,
      });

      if (response.data) {
        setRows((prev) =>
          prev.map((task) =>
            Number(task.id) === Number(id)
              ? mergeTaskUpdate(task, response.data)
              : task
          )
        );
        setSelectedTask((prev: any) =>
          prev && Number(prev.id) === Number(id)
            ? mergeTaskUpdate(prev, response.data)
            : prev
        );
      }

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

      setSelectedTask((prev: any) =>
        prev && Number(prev.id) === Number(submitTask.id)
          ? {
              ...prev,
              status: 'SUBMITTED',
              display_status: 'SUBMITTED',
              progress: 100,
            }
          : prev
      );

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

  async function remove() {
  if (!deleteTask) return;

  try {
    setDeleting(true);
    setPageErr('');

    await api.delete(`/tasks/${deleteTask.id}`);

    setDeleteTask(null);

    await load();
  } catch (e) {
    setPageErr(messageOf(e));
  } finally {
    setDeleting(false);
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
    <div className="font-sans">
      {/* =====================================================
          PAGE TITLE
      ====================================================== */}

      <PageTitle
        title="Task Management"
        subtitle="Individual, multiple-user, team and department task assignment"
        action={
          canAssign ? (
            <div className="flex items-center gap-2">
              {(isSuper || user?.role === 'ADMIN') && teamView === 'tasks' && (
                <button
                  type="button"
                  className="btn !border-slate-300 !bg-slate-50 !text-slate-800 hover:!bg-slate-100"
                  onClick={backToTeams}
                >
                  ← Back to Teams
                </button>
              )}

              {(isSuper || user?.role === 'ADMIN') && (
                <button
                  type="button"
                  className={`btn ${
                    teamView !== 'none'
                      ? '!bg-emerald-700 !text-white hover:!bg-emerald-800'
                      : '!border-emerald-300 !bg-emerald-50 !text-emerald-800 hover:!bg-emerald-100'
                  }`}
                  onClick={() => void openTeams()}
                >
                  Teams
                </button>
              )}

              {isSuper && (
                <button
                  type="button"
                  className={`btn ${
                    showAdminTasks
                      ? '!bg-emerald-700 !text-white hover:!bg-emerald-800'
                      : '!border-emerald-300 !bg-emerald-50 !text-emerald-800 hover:!bg-emerald-100'
                  }`}
                  onClick={() => void toggleAdminTasks()}
                >
                  Admin
                </button>
              )}

              <button
                type="button"
                className={`btn ${
                  showDrafts
                    ? '!bg-amber-600 !text-white hover:!bg-amber-700'
                    : '!border-amber-300 !bg-amber-50 !text-amber-800 hover:!bg-amber-100'
                }`}
                onClick={() => void toggleDrafts()}
              >
                Drafts
              </button>

              <button
                className="btn btn-accent"
                onClick={() => {
                  setEditing(null);
                  setAssignmentType(
                    'INDIVIDUAL'
                  );
                  setErr('');
                  setShowDrafts(false);
                  setShow(true);
                }}
              >
                + Create Task
              </button>

            </div>
          ) : undefined
        }
      />

      {teamView === 'list' && (
        <div className="card p-5">
          <div className="mb-4">
            <h2 className="text-lg font-extrabold text-navy">
              Teams
            </h2>
            <p className="mt-1 text-sm muted">
              Select a Team Lead to view that team's tasks.
            </p>
          </div>

          {teamLeads.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {teamLeads.map((lead) => (
                <button
                  type="button"
                  key={lead.id}
                  className="card text-left !border-slate-200 p-4 transition hover:!border-emerald-300 hover:!shadow-md"
                  onClick={() => void openTeamTasks(lead)}
                >
                  <div className="text-base font-extrabold text-navy">
                    {lead.first_name} {lead.last_name}
                  </div>
                  <div className="mt-1 text-xs muted">
                    {lead.employee_code}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-emerald-700">
                    View Team Tasks →
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <Empty />
          )}
        </div>
      )}

      {teamView === 'tasks' && selectedTeamLead && (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">
            Team Tasks
          </div>
          <div className="mt-1 text-lg font-extrabold text-navy">
            {selectedTeamLead.first_name} {selectedTeamLead.last_name}
          </div>
        </div>
      )}

      {teamView !== 'list' && <>
      {/* =====================================================
          TASK TABS (ACTIVE VS PAST)
      ====================================================== */}
      <div className="flex items-center gap-2 mb-4 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => {
            setTaskTab('active');
            setShowDrafts(false);
            setFilters((prev: any) => ({ ...prev, status: '' }));
            void load(showAdminTasks, 'active', false);
          }}
          className={`px-4 py-2.5 text-sm font-extrabold rounded-xl transition-all flex items-center gap-2 ${
            taskTab === 'active' && !showDrafts
              ? 'bg-navy text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <CheckCircle2 size={16} />
          Active Tasks
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full ${
              taskTab === 'active' && !showDrafts
                ? 'bg-white/20 text-white font-bold'
                : 'bg-slate-100 text-slate-600 font-bold'
            }`}
          >
            {taskTab === 'active' && !showDrafts ? rows.length : ''}
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            setTaskTab('past');
            setShowDrafts(false);
            setFilters((prev: any) => ({ ...prev, status: '' }));
            void load(showAdminTasks, 'past', false);
          }}
          className={`px-4 py-2.5 text-sm font-extrabold rounded-xl transition-all flex items-center gap-2 ${
            taskTab === 'past' && !showDrafts
              ? 'bg-navy text-white shadow-sm'
              : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
          }`}
        >
          <Clock size={16} />
          Past Tasks
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full ${
              taskTab === 'past' && !showDrafts
                ? 'bg-white/20 text-white font-bold'
                : 'bg-slate-100 text-slate-600 font-bold'
            }`}
          >
            {taskTab === 'past' && !showDrafts ? rows.length : ''}
          </span>
        </button>
      </div>

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

        {!showDrafts && (
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
            <option value="">{taskTab === 'active' ? 'All active statuses' : 'All past tasks'}</option>
            {taskTab === 'active' ? (
              <>
                <option value="PENDING">PENDING</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="BLOCKED">BLOCKED</option>
                <option value="SUBMITTED">SUBMITTED</option>
                <option value="NEEDS_CHANGES">NEEDS_CHANGES</option>
                <option value="OVERDUE">OVERDUE</option>
              </>
            ) : (
              <option value="COMPLETED">COMPLETED</option>
            )}
          </select>
        )}

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
          TASK TABLE
      ====================================================== */}

      {rows.length ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-left text-[12px] font-sans">
              <thead className="border-b bg-slate-50 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-2.5 py-2.5">ID</th>
                  <th className="px-2.5 py-2.5">Task</th>
                  <th className="px-2.5 py-2.5">Assigned To</th>
                  <th className="px-2.5 py-2.5">Department</th>
                  <th className="px-2.5 py-2.5">Type</th>
                  <th className="px-2.5 py-2.5">Priority</th>
                  <th className="px-2.5 py-2.5">Status</th>
                  <th className="px-2.5 py-2.5">Start Date</th>
                  <th className="px-2.5 py-2.5">Deadline</th>
                  {taskTab === 'past' && (
                    <th className="px-2.5 py-2.5 text-emerald-700">Completed Date</th>
                  )}
                  <th className="px-2.5 py-2.5">Progress</th>
                  <th className="px-2.5 py-2.5 text-center">Action</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200 bg-white">
                {rows.map((t) => {
                  const isEditedTask = t.is_edited === true;

                  return (
                    <tr key={t.id} className="align-middle hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-2.5 py-2.5 text-[12px] font-extrabold text-navy">
                        #{t.id}
                      </td>

                      <td className="px-2.5 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="max-w-[210px] truncate font-semibold text-navy">
                            {t.title}
                          </div>
                          {isEditedTask && (
                            <span
                              className="inline-flex shrink-0 items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-emerald-700"
                              title="Task was edited"
                            >
                              EDITED
                            </span>
                          )}
                        </div>
                        {t.employee_code && (
                          <div className="mt-0.5 text-[10px] muted">
                            {t.employee_code}
                          </div>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        {t.assignee_name || '—'}
                      </td>

                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        {t.department_name || '—'}
                      </td>

                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        {t.task_type === 'NON_TECHNICAL'
                          ? 'Non-Technical'
                          : 'Technical'}
                      </td>

                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${priorityClass(
                            t.priority
                          )}`}
                        >
                          {priorityLabel(t.priority)}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        <span
                          className={`badge ${
                            t.display_status === 'OVERDUE'
                              ? '!bg-red-100 !text-red-700'
                              : t.status === 'COMPLETED'
                              ? '!bg-emerald-100 !text-emerald-800'
                              : ''
                          }`}
                        >
                          {t.display_status || t.status}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        {t.start_date
                          ? new Date(t.start_date).toLocaleDateString()
                          : '—'}
                      </td>

                      <td className="whitespace-nowrap px-2.5 py-2.5">
                        {t.due_date
                          ? new Date(t.due_date).toLocaleString()
                          : '—'}
                      </td>

                      {taskTab === 'past' && (
                        <td className="whitespace-nowrap px-2.5 py-2.5 font-semibold text-emerald-700">
                          {t.completed_at
                            ? new Date(t.completed_at).toLocaleString()
                            : '—'}
                        </td>
                      )}

                      <td className="px-2.5 py-2.5">
                        <div className="min-w-[90px]">
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span>{Number(t.progress || 0)}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded bg-slate-100">
                            <div
                              className="h-full bg-orange"
                              style={{
                                width: `${Math.min(
                                  Number(t.progress || 0),
                                  100
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-4 py-4 text-center">
                        <button
                          type="button"
                          className="btn btn-primary !px-4 !py-2"
                          onClick={() => {
                            setSelectedTask(t);
                            if (isEditedTask) {
                              markEditedTaskSeen(t);
                            }
                            setFlippedTaskId(null);
                            setHistoryError((prev) => ({
                              ...prev,
                              [Number(t.id)]: '',
                            }));
                          }}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        !pageErr && <Empty />
      )}

      {/* =========================================================
          TASK DETAILS MODAL
      ========================================================= */}
      {selectedTask && (() => {
        const t = selectedTask;
        const isAssignedEmployee = t.assigned_to === user?.employeeId;
        const canEditDraft =
          t.status === 'DRAFT' &&
          t.created_by === user?.employeeId &&
          canAssign;
        const isSubmitted =
          t.status === 'SUBMITTED' || t.display_status === 'SUBMITTED';
        const isNeedsChanges =
          t.status === 'NEEDS_CHANGES' ||
          t.display_status === 'NEEDS_CHANGES';
        const canSubmit =
          isAssignedEmployee &&
          Number(t.progress) >= 100 &&
          !['SUBMITTED', 'COMPLETED', 'REJECTED', 'CANCELLED'].includes(
            t.status
          );
        const canMarkWorkComplete =
          isAssignedEmployee &&
          t.status === 'IN_PROGRESS' &&
          Number(t.progress) < 100;
        const canCurrentUserReview =
          isReviewer &&
          t.can_review === true &&
          t.status === 'SUBMITTED' &&
          t.display_status !== 'REJECTED' &&
          t.display_status !== 'NEEDS_CHANGES';
        const superAdminApproved =
          t.super_admin_review_decision === 'APPROVE' ||
          t.super_admin_review_decision === 'APPROVED';
        const rejectionReviewerName =
          t.hierarchy_review_status === 'REJECTED_BY_TEAM_LEAD'
            ? t.lead_reviewer_name
            : t.hierarchy_review_status === 'REJECTED_BY_ADMIN'
            ? t.admin_reviewer_name
            : t.hierarchy_review_status === 'REJECTED_BY_SUPER_ADMIN'
            ? t.super_admin_reviewer_name
            : null;
        const rejectionComment =
          t.hierarchy_review_status === 'REJECTED_BY_TEAM_LEAD'
            ? t.lead_review_comment
            : t.hierarchy_review_status === 'REJECTED_BY_ADMIN'
            ? t.admin_review_comment
            : t.hierarchy_review_status === 'REJECTED_BY_SUPER_ADMIN'
            ? t.super_admin_review_comment
            : t.reviewer_comment;
        const historyOpen = flippedTaskId === Number(t.id);

        return (
          <Modal
            title={`Task #${t.id}`}
            onClose={() => {
              setSelectedTask(null);
              setFlippedTaskId(null);
            }}
          >
            <div className="max-h-[78vh] space-y-5 overflow-y-auto pr-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <span
                    className={`badge ${
                      t.display_status === 'OVERDUE'
                        ? '!bg-red-100 !text-red-700'
                        : t.display_status === 'DRAFT'
                        ? '!bg-amber-100 !text-amber-800'
                        : ''
                    }`}
                  >
                    {t.display_status || t.status}
                  </span>
                  <h2 className="mt-2 text-xl font-extrabold text-navy">
                    {t.title}
                  </h2>
                  <p className="mt-1 text-sm muted">
                    Assigned to {t.assignee_name || '—'} •{' '}
                    {t.department_name || 'No department'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {t.status === 'DRAFT' ? (
                    <>
                      <button
                        type="button"
                        className="btn !border-sky-300 !bg-sky-50 !text-sky-800"
                        onClick={() => {
                          setEditing(t);
                          setPublishDraftMode(false);
                          setErr('');
                          setSelectedTask(null);
                          setShow(true);
                        }}
                      >
                        Edit Draft
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setEditing(t);
                          setPublishDraftMode(true);
                          setErr('');
                          setSelectedTask(null);
                          setShow(true);
                        }}
                      >
                        Publish Draft
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn !border-slate-300 !bg-slate-100 !text-slate-800 hover:!bg-slate-200"
                        disabled={historyLoadingId === Number(t.id)}
                        onClick={() => void toggleReviewHistory(t)}
                      >
                        {historyLoadingId === Number(t.id)
                          ? 'Loading...'
                          : historyOpen
                          ? 'Hide Task History'
                          : 'Task History'}
                      </button>

                      {isAssignedEmployee && isNeedsChanges && (
                        <button
                          type="button"
                          className="btn !border-slate-300 !bg-slate-100 !text-slate-800"
                          onClick={() => {
                            setEditing(t);
                            setPublishDraftMode(false);
                            setErr('');
                            setShow(true);
                          }}
                        >
                          Edit Task
                        </button>
                      )}

                      {isSuper && (
                        <button
                          type="button"
                          className="btn !border-sky-300 !bg-sky-50 !text-sky-800"
                          onClick={() => {
                            setEditing(t);
                            setPublishDraftMode(false);
                            setErr('');
                            setShow(true);
                          }}
                        >
                          Edit
                        </button>
                      )}

                      {isSuper && (
                        <button
                          type="button"
                          className="btn !border-rose-300 !bg-rose-50 !text-rose-800"
                          onClick={() => setDeleteTask(t)}
                        >
                          Delete
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 text-sm font-extrabold text-navy">
                  Description
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {t.description || 'No description'}
                </p>
              </div>

              <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
                <div><b>Uploaded By:</b> {t.creator_name || 'System'}</div>
                <div><b>Created:</b> {t.created_at ? new Date(t.created_at).toLocaleString() : '—'}</div>
                <div><b>Start:</b> {t.start_date ? new Date(t.start_date).toLocaleDateString() : '—'}</div>
                <div><b>Deadline:</b> {t.due_date ? new Date(t.due_date).toLocaleString() : '—'}</div>
                <div><b>Scope:</b> {t.assignment_scope || '—'}</div>
                <div className="flex items-center gap-2">
                  <b>Priority:</b>
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${priorityClass(t.priority)}`}>
                    {priorityLabel(t.priority)}
                  </span>
                </div>
                <div><b>Type:</b> {t.task_type === 'NON_TECHNICAL' ? 'Non-Technical' : 'Technical'}</div>
                <div>
                  <b>Final Verification:</b>{' '}
                  {t.display_status === 'REJECTED'
                    ? 'Rejected'
                    : t.completed_at
                    ? `${new Date(t.completed_at).toLocaleString()}${
                        t.super_admin_reviewer_name
                          ? ` • ${t.super_admin_reviewer_name}`
                          : ''
                      }`
                    : 'Pending'}
                </div>
                {t.attachment_url && (
                  <div className="sm:col-span-2">
                    <a
                      className="text-orange underline"
                      href={t.attachment_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open attachment/reference
                    </a>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">Progress</span>
                  <span>{Number(t.progress || 0)}%</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded bg-slate-100">
                  <div
                    className="h-full bg-orange transition-all"
                    style={{ width: `${Math.min(Number(t.progress || 0), 100)}%` }}
                  />
                </div>
              </div>

              {isSubmitted && (
                <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
                  <div className="font-bold">⏳ Task Submitted for Review</div>
                  {t.completion_submitted_at && (
                    <div className="mt-1 text-xs">
                      Submitted: {new Date(t.completion_submitted_at).toLocaleString()}
                    </div>
                  )}
                  {t.proof_url && (
                    <a
                      className="mt-2 inline-block break-all text-blue-700 underline"
                      href={t.proof_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Submitted Proof
                    </a>
                  )}
                </div>
              )}

              {t.completion_submission_id && (
                <div className="rounded-xl border bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-extrabold text-navy">
                    Review Hierarchy
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm">
                      <span className="font-semibold">Team Lead</span>
                      <span className={reviewColor(t.lead_review_decision)}>
                        {reviewLabel(t.lead_review_decision, t.lead_reviewer_name)}
                      </span>
                    </div>
                    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm">
                      <span className="font-semibold">Admin</span>
                      <span className={reviewColor(t.admin_review_decision)}>
                        {reviewLabel(t.admin_review_decision, t.admin_reviewer_name)}
                      </span>
                    </div>
                    <div className="grid grid-cols-[110px_1fr] gap-3 text-sm">
                      <span className="font-semibold">Super Admin</span>
                      <span className={reviewColor(t.super_admin_review_decision)}>
                        {reviewLabel(t.super_admin_review_decision, t.super_admin_reviewer_name)}
                      </span>
                    </div>
                  </div>

                  {t.next_reviewer_role && (
                    <div className="mt-4 rounded-lg bg-blue-50 p-3 text-xs text-blue-800">
                      <b>
                        {t.next_reviewer_role === 'TEAM_LEAD'
                          ? 'Team Lead'
                          : t.next_reviewer_role === 'ADMIN'
                          ? 'Admin'
                          : 'Super Admin'}
                      </b>{' '}
                      approval pending.
                    </div>
                  )}

                  {superAdminApproved && (
                    <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800">
                      ✓ Approved by Super Admin
                    </div>
                  )}
                </div>
              )}

              {isNeedsChanges && (
                <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                  <div className="font-bold">⚠ Changes Requested</div>
                  {isAssignedEmployee && (
                    <div className="mt-1 font-semibold">
                      Edit the task, continue working, and resubmit it for review.
                    </div>
                  )}
                  {t.reviewer_comment && (
                    <div className="mt-1 whitespace-pre-wrap">{t.reviewer_comment}</div>
                  )}
                </div>
              )}

              {t.status === 'COMPLETED' && (
                <div className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
                  <div className="font-bold">✓ Verified & Completed</div>
                  {t.reviewer_comment && (
                    <div className="mt-1">Reviewer: {t.reviewer_comment}</div>
                  )}
                </div>
              )}

              {t.status === 'REJECTED' && (
                <div className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
                  <div className="font-bold">✕ Task Rejected</div>
                  {rejectionReviewerName && (
                    <div className="mt-1 font-semibold">
                      Rejected by {rejectionReviewerName}
                    </div>
                  )}
                  {rejectionComment && (
                    <div className="mt-1 whitespace-pre-wrap">{rejectionComment}</div>
                  )}
                </div>
              )}

              {t.status !== 'DRAFT' && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4">
                {isAssignedEmployee ? (
                  <>
                    {!['SUBMITTED', 'COMPLETED', 'REJECTED', 'CANCELLED'].includes(t.status) && (
                      <select
                        className="input max-w-52"
                        value={t.status === 'NEEDS_CHANGES' ? 'IN_PROGRESS' : t.status}
                        onChange={(e) => changeEmployeeStatus(t.id, e.target.value)}
                      >
                        <option value="PENDING">PENDING</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="BLOCKED">BLOCKED</option>
                      </select>
                    )}
                    {canMarkWorkComplete && (
                      <button
                        className="btn btn-primary"
                        onClick={() => markWorkComplete(t.id)}
                      >
                        Mark Work Complete
                      </button>
                    )}
                    {canSubmit && (
                      <button
                        className="btn btn-accent"
                        onClick={() => openSubmitModal(t)}
                      >
                        Submit for Review
                      </button>
                    )}
                    {isSubmitted && (
                      <span className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                        Awaiting Review
                      </span>
                    )}
                    {t.status === 'COMPLETED' && (
                      <span className="rounded-lg bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
                        ✓ Verified and Completed
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs muted">Progress: {t.progress}%</span>
                )}

                {canCurrentUserReview && (
                  <button
                    className="btn btn-accent"
                    onClick={() => openReviewModal(t)}
                  >
                    Review
                  </button>
                )}
              </div>
              )}

              {historyOpen && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold text-orange">TASK #{t.id}</div>
                      <h3 className="font-extrabold text-navy">Task History</h3>
                    </div>
                    <button
                      type="button"
                      className="btn !px-3 !py-1.5"
                      onClick={() => setFlippedTaskId(null)}
                    >
                      Hide History
                    </button>
                  </div>

                  {historyError[Number(t.id)] && (
                    <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                      {historyError[Number(t.id)]}
                    </div>
                  )}

                  {!historyError[Number(t.id)] &&
                    !reviewHistory[Number(t.id)]?.length && (
                      <div className="rounded-lg bg-white p-4 text-sm muted">
                        No history found.
                      </div>
                    )}

                  <div className="space-y-3">
                    {(Array.isArray(reviewHistory[Number(t.id)])
                      ? reviewHistory[Number(t.id)]
                      : []
                    ).map((history: any) => {
                      const eventType = String(history.event_type || '').toUpperCase();
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
                      const decision = String(history.decision || '').toUpperCase();

                      let title = 'History Event';
                      let icon = '•';
                      let boxClass = 'rounded-xl border bg-white p-4';
                      let titleClass = 'font-bold text-slate-800';

                      if (eventType === 'TASK_CREATED') {
                        title = 'Task Created';
                        icon = '📋';
                      } else if (eventType === 'SUBMISSION') {
                        title =
                          Number(history.submission_number || 1) > 1
                            ? 'Task Resubmitted'
                            : 'Task Submitted';
                        icon = '📤';
                        boxClass = 'rounded-xl border bg-blue-50 p-4';
                        titleClass = 'font-bold text-blue-800';
                      } else if (eventType === 'REVIEW') {
                        if (decision === 'APPROVED' || decision === 'APPROVE') {
                          title = `${roleLabel} Approved`;
                          icon = '✓';
                          boxClass = 'rounded-xl border bg-green-50 p-4';
                          titleClass = 'font-bold text-green-800';
                        } else if (decision === 'NEEDS_CHANGES') {
                          title = `${roleLabel} Requested Changes`;
                          icon = '⚠';
                          boxClass = 'rounded-xl border bg-amber-50 p-4';
                          titleClass = 'font-bold text-amber-800';
                        } else if (decision === 'REJECTED' || decision === 'REJECT') {
                          title = `${roleLabel} Rejected`;
                          icon = '✕';
                          boxClass = 'rounded-xl border bg-red-50 p-4';
                          titleClass = 'font-bold text-red-800';
                        } else if (decision === 'SKIPPED') {
                          title = `${roleLabel} Review Skipped`;
                          icon = '—';
                        } else {
                          title = `${roleLabel} Review`;
                          icon = '⏳';
                        }
                      } else if (eventType === 'EDITED') {
                        title = 'Task Edited';
                        icon = '✎';
                        boxClass = 'rounded-xl border border-emerald-200 bg-emerald-50 p-4';
                        titleClass = 'font-bold text-emerald-800';
                      } else if (eventType === 'STATUS_CHANGED') {
                        title = 'Status Changed';
                        icon = '↻';
                      }

                      return (
                        <div
                          key={`${eventType}-${history.review_id || history.submission_id || history.sequence}`}
                          className={boxClass}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className={titleClass}>{icon} {title}</div>
                            {history.event_at && (
                              <div className="text-xs muted">
                                {new Date(history.event_at).toLocaleString()}
                              </div>
                            )}
                          </div>

                          <div className="mt-2 text-sm">
                            <b>By:</b> {history.actor_name || 'System'}
                          </div>

                          {eventType === 'EDITED' && (
                            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-white/70 p-3">
                              <div className="text-sm text-emerald-900">
                                Task fields were modified.
                              </div>
                              <button
                                type="button"
                                className="btn !border-emerald-300 !bg-emerald-700/10 !text-emerald-800 !px-3 !py-1.5"
                                onClick={() => setEditDetails(history)}
                              >
                                View Details
                              </button>
                            </div>
                          )}

                          {eventType === 'REVIEW' && (
                            <div className="mt-1 text-sm"><b>Role:</b> {roleLabel}</div>
                          )}

                          {eventType === 'REVIEW' && decision && (
                            <div className="mt-1 text-sm">
                              <b>Decision:</b>{' '}
                              {decision === 'APPROVE' || decision === 'APPROVED'
                                ? 'Approved'
                                : decision === 'NEEDS_CHANGES'
                                ? 'Changes Requested'
                                : decision === 'REJECT' || decision === 'REJECTED'
                                ? 'Rejected'
                                : decision === 'SKIPPED'
                                ? 'Skipped'
                                : decision}
                            </div>
                          )}

                          {eventType === 'STATUS_CHANGED' && (
                            <div className="mt-1 text-sm">
                              <b>Status:</b> {history.old_status || '—'} → {history.new_status || '—'}
                            </div>
                          )}

                          {eventType === 'SUBMISSION' && history.submission_id && (
                            <div className="mt-1 text-sm">
                              <b>Submission:</b> #{history.submission_number || 1}
                            </div>
                          )}

                          {history.comment && (
                            <div className="mt-2 whitespace-pre-wrap text-sm">
                              <b>{eventType === 'REVIEW' && decision === 'NEEDS_CHANGES' ? 'Reason:' : 'Comment:'}</b>{' '}
                              {history.comment}
                            </div>
                          )}

                          {history.completion_summary && (
                            <div className="mt-2 whitespace-pre-wrap text-sm">
                              <b>Completion Summary:</b> {history.completion_summary}
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
                      <div className="font-bold text-green-800">✓ Final Verification</div>
                      <div className="mt-1 text-sm text-green-800">
                        Super Admin final approval recorded at{' '}
                        {new Date(t.completed_at).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setSelectedTask(null);
                    setFlippedTaskId(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* =========================================================
          EDIT HISTORY DETAILS MODAL
      ========================================================= */}
      {editDetails && (
        <Modal
          title="Task Edit Details"
          onClose={() => setEditDetails(null)}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="font-bold text-emerald-800">
                Task Edited
              </div>

              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <b>Edited By:</b>{' '}
                  {editDetails.actor_name || 'System'}
                </div>

                <div>
                  <b>Role:</b>{' '}
                  {editDetails.actor_role === 'SUPER_ADMIN'
                    ? 'Super Admin'
                    : editDetails.actor_role === 'TEAM_LEAD'
                    ? 'Team Lead'
                    : editDetails.actor_role === 'ADMIN'
                    ? 'Admin'
                    : editDetails.actor_role === 'EMPLOYEE'
                    ? 'Employee'
                    : editDetails.actor_role || 'System'}
                </div>

                <div className="sm:col-span-2">
                  <b>Edited At:</b>{' '}
                  {editDetails.event_at
                    ? new Date(
                        editDetails.event_at
                      ).toLocaleString()
                    : '—'}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 font-bold text-navy">
                What Changed
              </div>

              {editDetails.changes &&
              typeof editDetails.changes === 'object' &&
              Object.keys(editDetails.changes).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(editDetails.changes).map(
                    ([field, change]: [string, any]) => {
                      const oldValue =
                        change?.oldValue === null ||
                        change?.oldValue === undefined ||
                        change?.oldValue === ''
                          ? '—'
                          : String(change.oldValue);

                      const newValue =
                        change?.newValue === null ||
                        change?.newValue === undefined ||
                        change?.newValue === ''
                          ? '—'
                          : String(change.newValue);

                      return (
                        <div
                          key={field}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                        >
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            {change?.label || field}
                          </div>

                          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                              <div className="text-[10px] font-bold uppercase tracking-wide text-red-600">
                                Previous
                              </div>
                              <div className="mt-1 whitespace-pre-wrap break-words">
                                {oldValue}
                              </div>
                            </div>

                            <div className="hidden text-lg font-bold text-slate-400 sm:block">
                              →
                            </div>

                            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                              <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                                Updated
                              </div>
                              <div className="mt-1 whitespace-pre-wrap break-words">
                                {newValue}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              ) : (
                <div className="text-sm muted">
                  No field-level changes were recorded.
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setEditDetails(null)}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* =========================================================
          CREATE / EDIT TASK MODAL
      ========================================================= */}

      </>}

      {show && (
        <Modal
          title={
            editing
              ? publishDraftMode
                ? 'Publish Draft'
                : user?.role === 'EMPLOYEE'
                ? 'Edit Task & Continue Work'
                : 'Edit Task'
              : 'Create Task'
          }
          onClose={() => {
            setShow(false);
            setEditing(null);
            setPublishDraftMode(false);
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

                    {(['ADMIN', 'SUPER_ADMIN'] as string[]).includes(user?.role || '') && (
                      <option value="ADMIN">
                        Admin
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

                {/* ADMIN */}

                {assignmentType === 'ADMIN' && (
                  <select
                    name="assignedTo"
                    className="input"
                  >
                    <option value="">
                      Select Admin
                    </option>

                    {emps
                      .filter(
                        (e) =>
                          e.role === 'ADMIN' &&
                          e.status === 'ACTIVE'
                      )
                      .map((e) => (
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
                {String(editing.status || '').toUpperCase() === 'DRAFT' ? (
                  <>
                    <div>
                      <label className="label">Assignment Type</label>
                      <select
                        className="input mt-1"
                        value={assignmentType}
                        onChange={(e) => setAssignmentType(e.target.value)}
                      >
                        <option value="INDIVIDUAL">Individual employee/intern</option>
                        <option value="MULTIPLE">Multiple employees/interns</option>
                        <option value="TEAM">Entire team</option>
                        {user?.role !== 'TEAM_LEAD' && <option value="DEPARTMENT">Department</option>}
                        {(['ADMIN', 'SUPER_ADMIN'] as string[]).includes(user?.role || '') && <option value="ADMIN">Admin</option>}
                      </select>
                    </div>

                    {assignmentType === 'INDIVIDUAL' && (
                      <select name="assignedTo" className="input">
                        <option value="">Select user</option>
                        {emps.map((e) => (
                          <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
                        ))}
                      </select>
                    )}

                    {assignmentType === 'MULTIPLE' && (
                      <div>
                        <label className="label">Select multiple users</label>
                        <select multiple name="assignedToIds" className="input mt-1 min-h-36">
                          {emps.map((e) => (
                            <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {assignmentType === 'TEAM' && user?.role !== 'TEAM_LEAD' && (
                      <select name="teamLeadId" className="input">
                        <option value="">Select team / Team Lead</option>
                        {teamLeads.map((e) => (
                          <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
                        ))}
                      </select>
                    )}

                    {assignmentType === 'TEAM' && user?.role === 'TEAM_LEAD' && (
                      <div className="rounded-lg bg-slate-50 p-3 text-sm">This task will be assigned to all current members under your supervision.</div>
                    )}

                    {assignmentType === 'DEPARTMENT' && (
                      <select name="departmentId" className="input">
                        <option value="">Select department</option>
                        {deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    )}

                    {assignmentType === 'ADMIN' && (
                      <select name="assignedTo" className="input">
                        <option value="">Select Admin</option>
                        {emps.filter((e) => e.role === 'ADMIN' && e.status === 'ACTIVE').map((e) => (
                          <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
                        ))}
                      </select>
                    )}

                    <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                      Draft fields remain optional while saving. Assignment is required only when publishing.
                    </div>

                    <div>
                      <label className="label">Task Type</label>
                      <select name="taskType" className="input mt-1" defaultValue={editing.task_type || 'TECHNICAL'}>
                        <option value="TECHNICAL">Technical — GitHub proof</option>
                        <option value="NON_TECHNICAL">Non-Technical — Google Drive proof</option>
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <select name="assignedTo" className="input" defaultValue={editing.assigned_to}>
                      {emps.map((e) => <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>)}
                    </select>
                    <div>
                      <label className="label">Task Type</label>
                      <select name="taskType" className="input mt-1" defaultValue={editing.task_type || 'TECHNICAL'}>
                        <option value="TECHNICAL">Technical — GitHub proof</option>
                        <option value="NON_TECHNICAL">Non-Technical — Google Drive proof</option>
                      </select>
                    </div>
                  </>
                )}
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
                  defaultValue={toDateTimeLocal(editing?.due_date)}
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

            {editing && user?.role !== 'EMPLOYEE' && String(editing.status || '').toUpperCase() !== 'DRAFT' && (
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

            {editing ? (
              String(editing.status || '').toUpperCase() === 'DRAFT' ? (
                <div className="flex flex-wrap gap-3">
                  <button type="submit" name="saveMode" value="DRAFT" className="btn !border-amber-300 !bg-amber-50 !text-amber-800 hover:!bg-amber-100">
                    Save Draft
                  </button>
                  <button type="submit" name="saveMode" value="PUBLISH" className="btn btn-primary">
                    Publish Draft
                  </button>
                </div>
              ) : (
                <button className="btn btn-primary">
                  {user?.role === 'EMPLOYEE' ? 'Save & Continue Work' : 'Save Changes'}
                </button>
              )
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  name="saveMode"
                  value="DRAFT"
                  className="btn !border-amber-300 !bg-amber-50 !text-amber-800 hover:!bg-amber-100"
                >
                  Save as Draft
                </button>
                <button
                  type="submit"
                  name="saveMode"
                  value="CREATE"
                  className="btn btn-primary inline-flex items-center justify-center gap-2"
                  disabled={creatingTask}
                >
                  {creatingTask ? (
                    <>
                      <span
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                        aria-hidden="true"
                      />
                      Creating...
                    </>
                  ) : (
                    'Create & Notify'
                  )}
                </button>
              </div>
            )}

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
{/* =========================================================
    DELETE TASK CONFIRMATION MODAL
========================================================= */}

{deleteTask && (
  <Modal
    title="Delete Task?"
    onClose={() => {
      if (!deleting) {
        setDeleteTask(null);
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
              Are you sure you want to delete this task?
            </h3>

            <p className="mt-1 text-sm text-red-700">
              This action cannot be undone.
            </p>
          </div>

        </div>
      </div>

      {/* Task Information */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">

        <div className="text-xs font-bold text-orange">
          TASK #{deleteTask.id}
        </div>

        <h3 className="mt-1 text-lg font-bold text-navy">
          {deleteTask.title}
        </h3>

        {deleteTask.assignee_name && (
          <div className="mt-1 text-sm muted">
            Assigned to {deleteTask.assignee_name}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">

          <div className="rounded-lg bg-white p-3">
            <div className="text-xs muted">
              Status
            </div>

            <div className="mt-1">
              <span className="badge">
                {deleteTask.display_status || deleteTask.status}
              </span>
            </div>
          </div>

          <div className="rounded-lg bg-white p-3">
            <div className="text-xs muted">
              Progress
            </div>

            <div className="mt-1 font-semibold">
              {Number(deleteTask.progress || 0)}%
            </div>
          </div>

          <div className="rounded-lg bg-white p-3">
            <div className="text-xs muted">
              Priority
            </div>

            <div className="mt-1 font-semibold">
              {priorityLabel(deleteTask.priority)}
            </div>
          </div>

          <div className="rounded-lg bg-white p-3">
            <div className="text-xs muted">
              Department
            </div>

            <div className="mt-1 font-semibold">
              {deleteTask.department_name || 'No department'}
            </div>
          </div>

        </div>

        {deleteTask.description && (
          <div className="mt-3 rounded-lg bg-white p-3">

            <div className="text-xs muted">
              Description
            </div>

            <div className="mt-1 whitespace-pre-wrap break-words text-sm">
              {deleteTask.description}
            </div>

          </div>
        )}

      </div>

      {/* Important Warning */}
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Deleting this task may also remove its submissions,
        review history and related task records.
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-3">

        <button
          type="button"
          className="btn"
          disabled={deleting}
          onClick={() => setDeleteTask(null)}
        >
          Cancel
        </button>

        <button
          type="button"
          className="btn bg-red-600 text-white hover:bg-red-700"
          disabled={deleting}
          onClick={() => void remove()}
        >
          {deleting ? 'Deleting...' : 'Delete Task'}
        </button>

      </div>

    </div>
  </Modal>
)}
    </div>
  );
}
