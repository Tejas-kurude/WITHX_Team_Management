import { useEffect, useState } from 'react';
import { api, messageOf } from '../services/api';
import { PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

const API_ORIGIN = String(
  import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
).replace(/\/api\/?$/, '');

function employeePhotoUrl(
  value: string | null | undefined
) {
  if (!value) return '';

  if (
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('data:')
  ) {
    return value;
  }

  return `${API_ORIGIN}${
    value.startsWith('/') ? value : `/${value}`
  }`;
}

export default function Profile() {
  const { user } = useAuth();

  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState('');
  const [fullImageUrl, setFullImageUrl] = useState('');

  useEffect(() => {
    if (user?.employeeId) {
      void api
        .get(`/employees/${user.employeeId}`)
        .then((r) => setP(r.data))
        .catch((e) => setErr(messageOf(e)));
    }
  }, [user?.employeeId]);

  function formatRole(role?: string) {
    if (!role) return '—';

    return role
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (char) =>
        char.toUpperCase()
      );
  }

  function formatDate(date?: string) {
    if (!date) return '—';

    return new Date(date).toLocaleDateString(
      'en-IN',
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }
    );
  }

  function getInitials() {
    if (!p) return 'WX';

    const first =
      p.first_name?.charAt(0) || '';

    const last =
      p.last_name?.charAt(0) || '';

    return `${first}${last}`.toUpperCase() || 'WX';
  }

  const profilePhoto =
    employeePhotoUrl(p?.photo_url);

  return (
    <>
      <PageTitle
        title="My Profile"
        subtitle="View your official WITHX employee identity and work information."
      />

      {err && (
        <div className="mb-5 rounded-xl bg-red-50 p-4 text-sm font-medium text-red-700">
          {err}
        </div>
      )}

      {p && (
        <div className="max-w-5xl">

          <div className="card overflow-hidden">

            {/* TOP PROFILE SECTION */}
            <div className="border-b border-slate-100 p-6 sm:p-8">

              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">

                {/* PROFILE IDENTITY */}
                <div className="flex items-center gap-5">

                  {/* PROFILE PHOTO */}
                  {profilePhoto ? (
                    <button
                      type="button"
                      className="group relative shrink-0 rounded-2xl"
                      onClick={() =>
                        setFullImageUrl(profilePhoto)
                      }
                      title="Click to view full photo"
                    >
                      <img
                        src={profilePhoto}
                        alt={`${p.first_name} ${p.last_name}`}
                        className="h-20 w-20 rounded-2xl border-2 border-white object-cover shadow-md transition duration-200 group-hover:scale-105"
                      />

                      <span className="absolute inset-x-1 bottom-1 rounded-md bg-black/60 px-1 py-0.5 text-[9px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
                        View Photo
                      </span>
                    </button>
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-navy text-2xl font-extrabold text-white shadow-sm">
                      {getInitials()}
                    </div>
                  )}

                  <div>

                    <div className="mb-1 text-xs font-extrabold uppercase tracking-[0.18em] text-orange">
                      {p.user_type || 'Employee'}
                    </div>

                    <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
                      {p.first_name}{' '}
                      {p.last_name}
                    </h2>

                    <div className="mt-1 text-sm font-semibold text-slate-600">
                      {p.job_title ||
                        formatRole(p.role)}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">

                      {p.department_name && (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                          {p.department_name}
                        </span>
                      )}

                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${
                          p.status === 'INACTIVE'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-green-50 text-green-700'
                        }`}
                      >
                        {formatRole(
                          p.status || 'ACTIVE'
                        )}
                      </span>

                    </div>

                  </div>

                </div>

                {/* EMPLOYEE CODE */}
                <div className="rounded-2xl bg-navy px-6 py-4 text-center text-white shadow-sm">

                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60">
                    Employee ID
                  </div>

                  <div className="mt-1 text-xl font-extrabold tracking-wide">
                    {p.employee_code}
                  </div>

                </div>

              </div>
            </div>

            {/* INFORMATION SECTION */}
            <div className="p-6 sm:p-8">

              <div className="grid gap-8 lg:grid-cols-2">

                {/* CONTACT INFORMATION */}
                <div>

                  <div className="mb-5">
                    <h3 className="text-base font-extrabold text-slate-900">
                      Contact Information
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      Your official account and login details.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-5">

                    <div className="space-y-5">

                      <div>
                        <div className="label">
                          Email / Login ID
                        </div>

                        <div className="mt-1 break-all text-sm font-semibold text-slate-900">
                          {p.email || '—'}
                        </div>
                      </div>

                      {p.phone && (
                        <div>
                          <div className="label">
                            Phone
                          </div>

                          <div className="mt-1 text-sm font-semibold text-slate-900">
                            {p.phone}
                          </div>
                        </div>
                      )}

                    </div>

                  </div>

                </div>

                {/* WORK INFORMATION */}
                <div>

                  <div className="mb-5">

                    <h3 className="text-base font-extrabold text-slate-900">
                      Work Information
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      Your role, department and employment details.
                    </p>

                  </div>

                  <div className="rounded-2xl bg-slate-50 p-5">

                    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">

                      <ProfileField
                        label="Role"
                        value={formatRole(p.role)}
                      />

                      <ProfileField
                        label="Department"
                        value={
                          p.department_name || '—'
                        }
                      />

                      <ProfileField
                        label="Team Lead"
                        value={
                          p.team_lead_name || '—'
                        }
                      />

                      <ProfileField
                        label="Job Title"
                        value={
                          p.job_title || '—'
                        }
                      />

                      <ProfileField
                        label="Joining Date"
                        value={formatDate(
                          p.joining_date
                        )}
                      />

                      <ProfileField
                        label="Employee Type"
                        value={
                          p.user_type
                            ? formatRole(
                                p.user_type
                              )
                            : '—'
                        }
                      />

                    </div>

                  </div>

                </div>

              </div>

            </div>

          </div>

        </div>
      )}

      {/* FULL SCREEN PROFILE PHOTO */}
      {fullImageUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() =>
            setFullImageUrl('')
          }
        >

          <div
            className="relative flex max-h-[92vh] max-w-[92vw] items-center justify-center"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            <img
              src={fullImageUrl}
              alt="Full profile"
              className="max-h-[90vh] max-w-[90vw] rounded-2xl bg-white object-contain shadow-2xl"
            />

            <button
              type="button"
              className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl font-bold text-slate-800 shadow-lg hover:bg-slate-100"
              onClick={() =>
                setFullImageUrl('')
              }
              aria-label="Close profile photo"
            >
              ×
            </button>

          </div>

        </div>
      )}
    </>
  );
}

function ProfileField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>

      <div className="label">
        {label}
      </div>

      <div className="mt-1 text-sm font-semibold text-slate-900">
        {value}
      </div>

    </div>
  );
}