import { FormEvent, useEffect, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Modal, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

export default function Notifications() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';

  const [rows, setRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(null);
  const [pageErr, setPageErr] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    try {
      setPageErr('');
      const r = await api.get('/notifications');
      setRows(r.data);
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function read(id: number) {
    try {
      await api.put(`/notifications/${id}/read`);
      await load();
    } catch (e) {
      setPageErr(messageOf(e));
    }
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr('');

    try {
      await api.put(
        `/notifications/${editing.id}`,
        Object.fromEntries(new FormData(e.currentTarget).entries())
      );

      setEditing(null);
      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  async function remove(id: number) {
    if (!confirm('Are you sure you want to delete this notification?')) return;

    try {
      await api.delete(`/notifications/${id}`);
      await load();
    } catch (e) {
      alert(messageOf(e));
    }
  }

  function getNotificationType(notification: any) {
    const text = `${notification.title ?? ''} ${notification.message ?? ''}`.toLowerCase();

    if (text.includes('leave')) return 'LEAVE';
    if (text.includes('attendance') || text.includes('check-in') || text.includes('checkout'))
      return 'ATTENDANCE';
    if (text.includes('report')) return 'REPORT';
    if (text.includes('performance')) return 'PERFORMANCE';
    if (text.includes('task')) return 'TASK';

    return 'SYSTEM';
  }

  function getTypeStyle(type: string) {
    switch (type) {
      case 'TASK':
        return 'bg-blue-50 text-blue-700';
      case 'LEAVE':
        return 'bg-purple-50 text-purple-700';
      case 'ATTENDANCE':
        return 'bg-green-50 text-green-700';
      case 'REPORT':
        return 'bg-amber-50 text-amber-700';
      case 'PERFORMANCE':
        return 'bg-orange-50 text-orange-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  }

  function formatDate(date: string) {
    const created = new Date(date);
    const now = new Date();

    const diff = now.getTime() - created.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return 'Just now';

    if (minutes < 60) {
      return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    }

    if (hours < 24) {
      return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    }

    const isToday = created.toDateString() === now.toDateString();

    if (isToday) {
      return `Today, ${created.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    }

    return created.toLocaleString([], {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const unreadCount = rows.filter((n) => !n.is_read).length;

  return (
    <>
      <PageTitle
        title="Notifications"
        subtitle="Stay informed about tasks, approvals, attendance, leave requests, reports and important system updates."
      />

      {/* Notification Summary */}
      {!pageErr && rows.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-medium muted">
            {unreadCount > 0 ? (
              <>
                You have{' '}
                <span className="font-bold text-orange">
                  {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
                </span>
              </>
            ) : (
              <span>You're all caught up.</span>
            )}
          </div>

          <div className="text-sm font-medium muted">
            {rows.length} notification{rows.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Error */}
      {pageErr && (
        <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {pageErr}
        </div>
      )}

      {/* Notifications */}
      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map((n) => {
            const type = getNotificationType(n);

            return (
              <div
                key={n.id}
                className={`card w-full p-5 transition ${
                  n.is_read
                    ? 'opacity-70'
                    : 'border-l-4 border-l-orange bg-orange-50/20'
                }`}
              >
                <div className="flex items-start justify-between gap-5">
                  {/* Notification Content */}
                  <button
                    type="button"
                    onClick={() => read(n.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    {/* Type + unread */}
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span
                       className={`rounded-full px-3 py-1.5 text-xs font-extrabold tracking-wide ${getTypeStyle(
  type
)}`} 
                      >
                        {type}
                      </span>

                      {!n.is_read && (
                        <span className="flex items-center gap-1.5 text-sm font-bold text-orange">
                          <span className="h-2 w-2 rounded-full bg-orange" />
                          New
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <div className="text-lg font-extrabold leading-7 text-slate-900">
                      {n.title}
                    </div>

                    {/* Employee */}
                    {n.employee_name && (
                      <div className="mt-1 text-xs font-bold text-orange">
                        {n.employee_name}
                      </div>
                    )}

                    {/* Message */}
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
                      {n.message}
                    </p>

                    {/* Time */}
                    <div className="mt-3 text-xs font-medium text-slate-400">
                      {formatDate(n.created_at)}
                    </div>
                  </button>

                  {/* Actions */}
                  {isSuper && (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className="btn !px-4 !py-2 text-sm font-semibold"
                        onClick={() => setEditing(n)}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="btn !px-3 !py-1.5 text-xs text-red-600"
                        onClick={() => remove(n.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !pageErr && (
          <div className="card flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 text-4xl">🔔</div>

            <h3 className="text-lg font-extrabold text-slate-900">
              No notifications yet
            </h3>

            <p className="mt-2 max-w-md text-sm leading-6 muted">
              You're all caught up. New task updates, approvals, leave requests,
              attendance alerts, reports and important system updates will appear
              here.
            </p>
          </div>
        )
      )}

      {/* Edit Modal */}
      {editing && (
        <Modal title="Edit Notification" onClose={() => setEditing(null)}>
          <form className="space-y-4" onSubmit={save}>
            <div>
              <label className="mb-1.5 block text-sm font-bold">
                Notification Title
              </label>

              <input
                className="input"
                name="title"
                defaultValue={editing.title}
                placeholder="Enter notification title"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-bold">
                Notification Message
              </label>

              <textarea
                className="input min-h-28"
                name="message"
                defaultValue={editing.message}
                placeholder="Enter notification message"
                required
              />
            </div>

            {err && (
              <div className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-600">
                {err}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                className="btn"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>

              <button className="btn btn-primary">
                Save Changes
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
