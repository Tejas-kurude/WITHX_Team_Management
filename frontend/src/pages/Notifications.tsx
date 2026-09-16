import {
  FormEvent,
  useEffect,
  useMemo,
  useState
} from 'react';

import { useSearchParams } from 'react-router-dom';

import {
  api,
  messageOf
} from '../services/api';

import {
  Modal,
  PageTitle
} from '../components/UI';

import { useAuth } from '../context/AuthContext';


export default function Notifications() {
  const { user } = useAuth();

  const isSuper =
    user?.role === 'SUPER_ADMIN';

  const [searchParams] =
    useSearchParams();


  /* =========================================================
     DATA
  ========================================================= */

  const [rows, setRows] =
    useState<any[]>([]);

  const [unreadCount, setUnreadCount] =
    useState(0);

  const [loading, setLoading] =
    useState(true);

  const [pageErr, setPageErr] =
    useState('');


  /* =========================================================
     DETAILS / EDIT / DELETE
  ========================================================= */

  const [selected, setSelected] =
    useState<any | null>(null);

  const [editing, setEditing] =
    useState<any | null>(null);

  const [deleteNotification, setDeleteNotification] =
    useState<any | null>(null);

  const [confirmClear, setConfirmClear] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [clearing, setClearing] =
    useState(false);

  const [err, setErr] =
    useState('');


  /* =========================================================
     FILTERS
  ========================================================= */

  const [search, setSearch] =
    useState('');

  const [typeFilter, setTypeFilter] =
    useState('ALL');

  const [readFilter, setReadFilter] =
    useState(
      searchParams.get('status') === 'UNREAD'
        ? 'UNREAD'
        : 'ALL'
    );

  const [dateFilter, setDateFilter] =
    useState('');

  const [notificationClickTimer, setNotificationClickTimer] =
    useState<ReturnType<typeof setTimeout> | null>(null);


  /* =========================================================
     LOAD NOTIFICATIONS
  ========================================================= */

  async function load() {
    try {
      setLoading(true);
      setPageErr('');

      const [
        notificationsResponse,
        unreadResponse
      ] = await Promise.all([
        api.get('/notifications'),

        api.get(
          '/notifications/unread-count'
        )
      ]);

      setRows(
        Array.isArray(
          notificationsResponse.data
        )
          ? notificationsResponse.data
          : []
      );

      setUnreadCount(
        Number(
          unreadResponse.data
            ?.unreadCount || 0
        )
      );

    } catch (e) {

      setPageErr(
        messageOf(e)
      );

    } finally {

      setLoading(false);
    }
  }


  useEffect(() => {
    void load();
  }, []);


  /* =========================================================
     NOTIFICATION CATEGORY
  ========================================================= */

  function notificationCategory(
    notification: any
  ) {
    const type =
      String(
        notification.type || ''
      ).toUpperCase();

    if (
      type.startsWith('TASK')
    ) {
      return 'TASK';
    }

    if (
      type.startsWith('LEAVE')
    ) {
      return 'LEAVE';
    }

    if (
      type.includes('ATTENDANCE')
    ) {
      return 'ATTENDANCE';
    }

    if (
      type.includes('REPORT')
    ) {
      return 'REPORT';
    }

    if (
      type.includes('PERFORMANCE')
    ) {
      return 'PERFORMANCE';
    }

    return 'SYSTEM';
  }


  function typeStyle(
    type: string
  ) {
    switch (type) {

      case 'TASK':
        return (
          'border-blue-200 ' +
          'bg-blue-50 ' +
          'text-blue-700'
        );

      case 'LEAVE':
        return (
          'border-purple-200 ' +
          'bg-purple-50 ' +
          'text-purple-700'
        );

      case 'ATTENDANCE':
        return (
          'border-green-200 ' +
          'bg-green-50 ' +
          'text-green-700'
        );

      case 'REPORT':
        return (
          'border-amber-200 ' +
          'bg-amber-50 ' +
          'text-amber-700'
        );

      case 'PERFORMANCE':
        return (
          'border-orange-200 ' +
          'bg-orange-50 ' +
          'text-orange-700'
        );

      default:
        return (
          'border-slate-200 ' +
          'bg-slate-100 ' +
          'text-slate-700'
        );
    }
  }


  /* =========================================================
     DATE HELPERS
  ========================================================= */

  function formatDate(
    value: string
  ) {
    if (!value) return '—';

    return new Date(
      value
    ).toLocaleDateString(
      [],
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }
    );
  }


  function formatTime(
    value: string
  ) {
    if (!value) return '—';

    return new Date(
      value
    ).toLocaleTimeString(
      [],
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    );
  }


  function shortText(
    value: string,
    limit = 100
  ) {
    if (!value) {
      return '—';
    }

    if (
      value.length <= limit
    ) {
      return value;
    }

    return (
      value.slice(
        0,
        limit
      ) + '...'
    );
  }


  /* =========================================================
     FILTERED DATA
  ========================================================= */

  const filteredRows =
    useMemo(() => {

      const q =
        search
          .trim()
          .toLowerCase();

      return rows.filter(
        notification => {

          const category =
            notificationCategory(
              notification
            );

          const matchesSearch =
            !q ||

            String(
              notification.title || ''
            )
              .toLowerCase()
              .includes(q) ||

            String(
              notification.message || ''
            )
              .toLowerCase()
              .includes(q);


          const matchesType =
            typeFilter === 'ALL' ||
            category ===
              typeFilter;


          const matchesRead =
            readFilter === 'ALL' ||

            (
              readFilter === 'UNREAD' &&
              !notification.is_read
            ) ||

            (
              readFilter === 'READ' &&
              notification.is_read
            );


          const matchesDate =
            !dateFilter ||

            (
              notification.created_at &&

              new Date(
                notification.created_at
              )
                .toLocaleDateString(
                  'en-CA'
                ) ===
                dateFilter
            );


          return (
            matchesSearch &&
            matchesType &&
            matchesRead &&
            matchesDate
          );
        }
      );

    }, [
      rows,
      search,
      typeFilter,
      readFilter,
      dateFilter
    ]);


  /* =========================================================
     VIEW DETAILS / MARK READ
  ========================================================= */

  async function openNotification(
    notification: any
  ) {
    setSelected(
      notification
    );

    if (
      notification.is_read
    ) {
      return;
    }

    try {

      await api.put(
        `/notifications/${notification.id}/read`
      );


      setRows(
        current =>
          current.map(
            item =>
              item.id ===
              notification.id

                ? {
                    ...item,
                    is_read: true
                  }

                : item
          )
      );


      setSelected({
        ...notification,
        is_read: true
      });


      setUnreadCount(
        current =>
          Math.max(
            0,
            current - 1
          )
      );

    } catch (e) {

      setPageErr(
        messageOf(e)
      );
    }
  }


  /* =========================================================
     DELETE ONE
  ========================================================= */

  async function remove() {
    if (
      !deleteNotification
    ) {
      return;
    }

    try {

      setDeleting(true);
      setPageErr('');


      await api.delete(
        `/notifications/${deleteNotification.id}`
      );


      const wasUnread =
        !deleteNotification.is_read;


      setRows(
        current =>
          current.filter(
            item =>
              item.id !==
              deleteNotification.id
          )
      );


      if (wasUnread) {

        setUnreadCount(
          current =>
            Math.max(
              0,
              current - 1
            )
        );
      }


      if (
        selected?.id ===
        deleteNotification.id
      ) {
        setSelected(null);
      }


      setDeleteNotification(
        null
      );

    } catch (e) {

      setPageErr(
        messageOf(e)
      );

    } finally {

      setDeleting(false);
    }
  }


  /* =========================================================
     CLEAR ALL
  ========================================================= */

  async function clearAll() {
    try {

      setClearing(true);
      setPageErr('');


      await api.delete(
        '/notifications'
      );


      setRows([]);

      setUnreadCount(0);

      setSelected(null);

      setConfirmClear(false);

    } catch (e) {

      setPageErr(
        messageOf(e)
      );

    } finally {

      setClearing(false);
    }
  }


  /* =========================================================
     EDIT
     SUPER ADMIN ONLY
  ========================================================= */

  async function saveEdit(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!editing) return;

    try {

      setErr('');


      const body =
        Object.fromEntries(
          new FormData(
            e.currentTarget
          ).entries()
        );


      await api.put(
        `/notifications/${editing.id}`,
        body
      );


      setEditing(null);

      await load();

    } catch (e) {

      setErr(
        messageOf(e)
      );
    }
  }


  /* =========================================================
     RESET FILTERS
  ========================================================= */

  function resetFilters() {
    setSearch('');
    setTypeFilter('ALL');
    setReadFilter('ALL');
    setDateFilter('');
  }

  function handleUnreadSingleClick() {
    if (notificationClickTimer) {
      clearTimeout(notificationClickTimer);
    }

    const timer = setTimeout(() => {
      setReadFilter('UNREAD');
      setNotificationClickTimer(null);
    }, 250);

    setNotificationClickTimer(timer);
  }

  function handleUnreadDoubleClick() {
    if (notificationClickTimer) {
      clearTimeout(notificationClickTimer);
      setNotificationClickTimer(null);
    }

    setReadFilter('ALL');
  }


  /* =========================================================
     UI
  ========================================================= */

  return (
    <>

      {/* =====================================================
          PAGE TITLE
      ===================================================== */}

      <PageTitle
        title="Notifications"
        subtitle="Stay informed about tasks, approvals, attendance, leave requests, reports and important system updates."
        action={
          <div className="flex items-center gap-3">

            {/* UNREAD COUNT */}

            <button
              type="button"
              onClick={handleUnreadSingleClick}
              onDoubleClick={handleUnreadDoubleClick}
              title="Single click: show unread notifications. Double click: show all notifications."
              className={
                `
                flex items-center
                gap-2 rounded-xl
                border px-4 py-2.5
                text-sm font-extrabold
                transition
                ${
                  unreadCount > 0

                    ? `
                      border-red-200
                      bg-red-50
                      text-red-700
                      hover:bg-red-100
                    `

                    : `
                      border-slate-200
                      bg-white
                      text-slate-600
                    `
                }
                `
              }
            >

              <span>
                🔔
              </span>

              <span>
                {unreadCount}
                {' '}
                Unread
              </span>

            </button>


            {/* CLEAR ALL */}

            <button
              type="button"
              className="btn btn-primary"
              disabled={
                rows.length === 0
              }
              onClick={() =>
                setConfirmClear(true)
              }
            >
              Clear All
            </button>

          </div>
        }
      />


      {/* =====================================================
          PAGE ERROR
      ===================================================== */}

      {pageErr && (
        <div
          className="
            mb-4 rounded-xl
            border border-red-200
            bg-red-50 p-4
            text-sm font-semibold
            text-red-700
          "
        >
          {pageErr}
        </div>
      )}


      {/* =====================================================
          FILTERS
      ===================================================== */}

      <div
        className="
          mb-4 rounded-2xl
          border border-slate-200
          bg-white p-4
        "
      >

        <div
          className="
            grid gap-3
            lg:grid-cols-12
          "
        >

          {/* SEARCH */}

          <div
            className="
              lg:col-span-5
            "
          >

            <input
              className="input w-full"
              value={search}
              onChange={
                e =>
                  setSearch(
                    e.target.value
                  )
              }
              placeholder="Search notification or message"
            />

          </div>


          {/* TYPE */}

          <div
            className="
              lg:col-span-2
            "
          >

            <select
              className="input w-full"
              value={typeFilter}
              onChange={
                e =>
                  setTypeFilter(
                    e.target.value
                  )
              }
            >

              <option value="ALL">
                All types
              </option>

              <option value="TASK">
                Task
              </option>

              <option value="LEAVE">
                Leave
              </option>

              <option value="ATTENDANCE">
                Attendance
              </option>

              <option value="REPORT">
                Report
              </option>

              <option value="PERFORMANCE">
                Performance
              </option>

              <option value="SYSTEM">
                System
              </option>

            </select>

          </div>


          {/* READ STATUS */}

          <div
            className="
              lg:col-span-2
            "
          >

            <select
              className="input w-full"
              value={readFilter}
              onChange={
                e =>
                  setReadFilter(
                    e.target.value
                  )
              }
            >

              <option value="ALL">
                All notifications
              </option>

              <option value="UNREAD">
                Unread only
              </option>

              <option value="READ">
                Read only
              </option>

            </select>

          </div>


          {/* DATE */}

          <div
            className="
              lg:col-span-2
            "
          >

            <input
              type="date"
              className="input w-full"
              value={dateFilter}
              onChange={
                e =>
                  setDateFilter(
                    e.target.value
                  )
              }
            />

          </div>


          {/* RESET */}

          <div
            className="
              lg:col-span-1
            "
          >

            <button
              type="button"
              className="btn w-full"
              onClick={
                resetFilters
              }
            >
              Reset
            </button>

          </div>

        </div>

      </div>


      {/* =====================================================
          SUMMARY
      ===================================================== */}

      {!loading &&
        rows.length > 0 && (

        <div
          className="
            mb-4 flex
            flex-wrap
            items-center
            justify-between
            gap-3
            rounded-xl
            border border-slate-200
            bg-white
            px-4 py-3
          "
        >

          <div
            className="
              text-sm
              font-semibold
              text-slate-600
            "
          >

            {unreadCount > 0

              ? (
                <>
                  <span
                    className="
                      font-extrabold
                      text-red-600
                    "
                  >
                    {unreadCount}
                  </span>

                  {' '}

                  unread notification
                  {unreadCount !== 1
                    ? 's'
                    : ''}
                </>
              )

              : (
                <>
                  You're all caught up.
                </>
              )}

          </div>


          <div
            className="
              text-sm
              font-semibold
              text-slate-500
            "
          >
            Showing:
            {' '}
            {filteredRows.length}
            {' '}
            of
            {' '}
            {rows.length}
          </div>

        </div>
      )}


      {/* =====================================================
          LOADING
      ===================================================== */}

      {loading && (

        <div
          className="
            card flex
            min-h-[220px]
            items-center
            justify-center
          "
        >
          <div
            className="
              text-sm
              font-semibold
              text-slate-500
            "
          >
            Loading notifications...
          </div>
        </div>

      )}


      {/* =====================================================
          TABLE
      ===================================================== */}

      {!loading &&
        filteredRows.length > 0 && (

        <div
          className="
            card
            overflow-hidden
            p-0
          "
        >

          <div
            className="
              overflow-x-auto
            "
          >

            <table
              className="
                w-full
                min-w-[950px]
                text-left
              "
            >

              <thead
                className="
                  border-b
                  border-slate-200
                  bg-slate-50
                "
              >

                <tr
                  className="
                    text-xs
                    font-extrabold
                    uppercase
                    tracking-wide
                    text-slate-500
                  "
                >

                  <th
                    className="
                      w-[110px]
                      px-4 py-4
                      text-center
                    "
                  >
                    Type
                  </th>

                  <th
                    className="
                      px-4 py-4
                    "
                  >
                    Notification
                  </th>

                  <th
                    className="
                      w-[130px]
                      px-4 py-4
                      text-center
                    "
                  >
                    Status
                  </th>

                  <th
                    className="
                      px-4 py-4
                    "
                  >
                    Date
                  </th>

                  <th
                    className="
                      px-4 py-4
                    "
                  >
                    Time
                  </th>

                  <th
                    className="
                      px-4 py-4
                      text-right
                    "
                  >
                    Action
                  </th>

                </tr>

              </thead>


              <tbody
                className="
                  divide-y
                  divide-slate-200
                "
              >

                {filteredRows.map(
                  notification => {

                    const category =
                      notificationCategory(
                        notification
                      );

                    const unread =
                      !notification.is_read;


                    return (

                      <tr
                        key={
                          notification.id
                        }
                        className={
                          `
                          transition
                          ${
                            unread

                              ? `
                                bg-red-50/60
                                hover:bg-red-50
                              `

                              : `
                                bg-white
                                hover:bg-slate-50
                              `
                          }
                          `
                        }
                      >

                        {/* TYPE */}

                        <td
                          className={
                            `
                            relative
                            px-4 py-4
                            align-middle
                            text-center

                            ${
                              unread

                                ? `
                                  border-l-4
                                  border-red-300
                                `

                                : `
                                  border-l-4
                                  border-transparent
                                `
                            }
                            `
                          }
                        >

                          <span
                            className={
                              `
                              inline-flex
                              min-w-[64px]
                              items-center
                              justify-center
                              rounded-full
                              border
                              px-2.5 py-1
                              text-[11px]
                              font-extrabold

                              ${typeStyle(
                                category
                              )}
                              `
                            }
                          >
                            {category}
                          </span>

                        </td>


                        {/* NOTIFICATION */}

                        <td
                          className="
                            max-w-[520px]
                            px-4 py-4
                            align-middle
                          "
                        >

                          <div
                            className="
                              font-extrabold
                              text-slate-900
                            "
                          >
                            {
                              notification.title ||
                              'Notification'
                            }
                          </div>


                          <div
                            className="
                              mt-1
                              text-sm
                              leading-5
                              text-slate-500
                            "
                          >
                            {shortText(
                              notification.message
                            )}
                          </div>

                        </td>


                        {/* STATUS */}

                        <td
                          className="
                            px-4 py-4
                            align-middle
                            text-center
                          "
                        >

                          {unread

                            ? (
                              <span
                                className="
                                  inline-flex
                                  min-w-[62px]
                                  items-center
                                  justify-center
                                  gap-1.5
                                  rounded-full
                                  border
                                  border-red-200
                                  bg-red-50
                                  px-2.5 py-1
                                  text-[11px]
                                  font-extrabold
                                  text-red-700
                                "
                              >

                                <span
                                  className="
                                    h-1.5
                                    w-1.5
                                    rounded-full
                                    bg-red-500
                                  "
                                />

                                NEW

                              </span>
                            )

                            : (
                              <span
                                className="
                                  inline-flex
                                  min-w-[62px]
                                  items-center
                                  justify-center
                                  rounded-full
                                  border
                                  border-slate-200
                                  bg-slate-100
                                  px-2.5 py-1
                                  text-[11px]
                                  font-extrabold
                                  text-slate-600
                                "
                              >
                                READ
                              </span>
                            )}

                        </td>


                        {/* DATE */}

                        <td
                          className="
                            whitespace-nowrap
                            px-4 py-4
                            align-middle
                            text-sm
                            font-semibold
                            text-slate-700
                          "
                        >
                          {formatDate(
                            notification.created_at
                          )}
                        </td>


                        {/* TIME */}

                        <td
                          className="
                            whitespace-nowrap
                            px-4 py-4
                            align-middle
                            text-sm
                            text-slate-600
                          "
                        >
                          {formatTime(
                            notification.created_at
                          )}
                        </td>


                        {/* ACTION */}

                        <td
                          className="
                            px-4 py-4
                            align-middle
                          "
                        >

                          <div
                            className="
                              flex
                              items-center
                              justify-end
                              gap-2
                            "
                          >

                            <button
                              type="button"
                              className="
                                btn
                                !px-3
                                !py-2
                                text-xs
                                font-bold
                              "
                              onClick={() =>
                                void openNotification(
                                  notification
                                )
                              }
                            >
                              View Details
                            </button>


                            {isSuper && (

                              <button
                                type="button"
                                className="
                                  btn
                                  !px-3
                                  !py-2
                                  text-xs
                                  font-bold
                                  text-cyan-700
                                "
                                onClick={() => {
                                  setErr('');

                                  setEditing(
                                    notification
                                  );
                                }}
                              >
                                Edit
                              </button>

                            )}


                            <button
                              type="button"
                              className="
                                btn
                                !px-3
                                !py-2
                                text-xs
                                font-bold
                                text-red-600
                              "
                              onClick={() =>
                                setDeleteNotification(
                                  notification
                                )
                              }
                            >
                              Delete
                            </button>

                          </div>

                        </td>

                      </tr>
                    );
                  }
                )}

              </tbody>

            </table>

          </div>

        </div>
      )}


      {/* =====================================================
          EMPTY STATE
      ===================================================== */}

      {!loading &&
        filteredRows.length === 0 &&
        !pageErr && (

        <div
          className="
            card
            flex
            min-h-[220px]
            flex-col
            items-center
            justify-center
            px-6
            text-center
          "
        >

          <div
            className="
              mb-3
              text-4xl
            "
          >
            🔔
          </div>


          <h3
            className="
              text-lg
              font-extrabold
              text-slate-900
            "
          >
            {
              rows.length

                ? 'No matching notifications'

                : 'No notifications'
            }
          </h3>


          <p
            className="
              mt-2
              max-w-md
              text-sm
              leading-6
              text-slate-500
            "
          >
            {
              rows.length

                ? (
                  'Try changing the search, type, read status or date filter.'
                )

                : (
                  "You're all caught up."
                )
            }
          </p>

        </div>
      )}


      {/* =====================================================
          DETAILS MODAL
      ===================================================== */}

      {selected && (

        <Modal
          title="Notification Details"
          onClose={() =>
            setSelected(null)
          }
        >

          <div
            className="
              space-y-5
            "
          >

            <div
              className="
                rounded-xl
                border
                border-slate-200
                bg-slate-50
                p-4
              "
            >

              <div
                className="
                  flex
                  flex-wrap
                  items-center
                  justify-between
                  gap-3
                "
              >

                <span
                  className={
                    `
                    rounded-full
                    border
                    px-3 py-1
                    text-xs
                    font-extrabold

                    ${typeStyle(
                      notificationCategory(
                        selected
                      )
                    )}
                    `
                  }
                >
                  {
                    notificationCategory(
                      selected
                    )
                  }
                </span>


                <span
                  className="
                    text-xs
                    font-semibold
                    text-slate-500
                  "
                >
                  {
                    selected.created_at

                      ? new Date(
                          selected.created_at
                        ).toLocaleString()

                      : '—'
                  }
                </span>

              </div>


              <div
                className="
                  mt-4
                  text-xl
                  font-extrabold
                  text-slate-900
                "
              >
                {
                  selected.title ||
                  'Notification'
                }
              </div>

            </div>


            <div>

              <div
                className="
                  text-xs
                  font-extrabold
                  uppercase
                  tracking-wide
                  text-slate-500
                "
              >
                Details
              </div>


              <div
                className="
                  mt-2
                  whitespace-pre-wrap
                  break-words
                  rounded-xl
                  border
                  border-slate-200
                  bg-white
                  p-4
                  text-sm
                  leading-6
                  text-slate-700
                "
              >
                {
                  selected.message ||
                  'No additional details available.'
                }
              </div>

            </div>


            <div
              className="
                flex
                justify-end
                gap-2
              "
            >

              <button
                type="button"
                className="btn"
                onClick={() => {

                  setSelected(null);

                  setDeleteNotification(
                    selected
                  );
                }}
              >
                Delete
              </button>


              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  setSelected(null)
                }
              >
                Close
              </button>

            </div>

          </div>

        </Modal>
      )}


      {/* =====================================================
          EDIT MODAL
      ===================================================== */}

      {editing && isSuper && (

        <Modal
          title="Edit Notification"
          onClose={() => {
            setEditing(null);
            setErr('');
          }}
        >

          <form
            className="space-y-4"
            onSubmit={
              saveEdit
            }
          >

            <div>

              <label
                className="
                  label
                "
              >
                Notification Title
              </label>

              <input
                className="
                  input mt-1
                "
                name="title"
                defaultValue={
                  editing.title
                }
                required
              />

            </div>


            <div>

              <label
                className="
                  label
                "
              >
                Notification Message
              </label>

              <textarea
                className="
                  input mt-1
                  min-h-28
                "
                name="message"
                defaultValue={
                  editing.message
                }
                required
              />

            </div>


            {err && (

              <div
                className="
                  rounded-lg
                  bg-red-50
                  p-3
                  text-sm
                  text-red-700
                "
              >
                {err}
              </div>

            )}


            <div
              className="
                flex
                justify-end
                gap-2
              "
            >

              <button
                type="button"
                className="btn"
                onClick={() => {

                  setEditing(null);

                  setErr('');
                }}
              >
                Cancel
              </button>


              <button
                type="submit"
                className="
                  btn
                  btn-primary
                "
              >
                Save Changes
              </button>

            </div>

          </form>

        </Modal>
      )}


      {/* =====================================================
          DELETE CONFIRMATION
      ===================================================== */}

      {deleteNotification && (

        <Modal
          title="Delete Notification?"
          onClose={() => {

            if (!deleting) {
              setDeleteNotification(
                null
              );
            }
          }}
        >

          <div
            className="
              space-y-5
            "
          >

            <div
              className="
                rounded-xl
                border
                border-red-200
                bg-red-50
                p-4
              "
            >

              <div
                className="
                  font-extrabold
                  text-red-800
                "
              >
                Delete this notification?
              </div>


              <div
                className="
                  mt-1
                  text-sm
                  text-red-700
                "
              >
                It will disappear only
                from your notification inbox.
                Other users will not be affected.
              </div>

            </div>


            <div
              className="
                rounded-xl
                border
                border-slate-200
                bg-slate-50
                p-4
              "
            >

              <div
                className="
                  font-bold
                  text-slate-900
                "
              >
                {
                  deleteNotification.title
                }
              </div>


              <div
                className="
                  mt-2
                  text-sm
                  leading-6
                  text-slate-600
                "
              >
                {
                  deleteNotification.message
                }
              </div>

            </div>


            <div
              className="
                flex
                justify-end
                gap-3
              "
            >

              <button
                type="button"
                className="btn"
                disabled={
                  deleting
                }
                onClick={() =>
                  setDeleteNotification(
                    null
                  )
                }
              >
                Cancel
              </button>


              <button
                type="button"
                className="
                  btn
                  bg-red-600
                  text-white
                  hover:bg-red-700
                "
                disabled={
                  deleting
                }
                onClick={() =>
                  void remove()
                }
              >
                {
                  deleting
                    ? 'Deleting...'
                    : 'Delete Notification'
                }
              </button>

            </div>

          </div>

        </Modal>
      )}


      {/* =====================================================
          CLEAR ALL CONFIRMATION
      ===================================================== */}

      {confirmClear && (

        <Modal
          title="Clear All Notifications?"
          onClose={() => {

            if (!clearing) {
              setConfirmClear(
                false
              );
            }
          }}
        >

          <div
            className="
              space-y-5
            "
          >

            <div
              className="
                rounded-xl
                border
                border-red-200
                bg-red-50
                p-4
              "
            >

              <div
                className="
                  font-extrabold
                  text-red-800
                "
              >
                Clear your entire notification inbox?
              </div>


              <div
                className="
                  mt-2
                  text-sm
                  leading-6
                  text-red-700
                "
              >
                This will clear notifications
                only from your account.
                Notifications belonging to
                Employees, Team Leads,
                Admins or Super Admins
                will not be affected.
              </div>

            </div>


            <div
              className="
                flex
                justify-end
                gap-3
              "
            >

              <button
                type="button"
                className="btn"
                disabled={
                  clearing
                }
                onClick={() =>
                  setConfirmClear(
                    false
                  )
                }
              >
                Cancel
              </button>


              <button
                type="button"
                className="
                  btn
                  bg-red-600
                  text-white
                  hover:bg-red-700
                "
                disabled={
                  clearing
                }
                onClick={() =>
                  void clearAll()
                }
              >
                {
                  clearing
                    ? 'Clearing...'
                    : 'Clear All'
                }
              </button>

            </div>

          </div>

        </Modal>
      )}

    </>
  );
}