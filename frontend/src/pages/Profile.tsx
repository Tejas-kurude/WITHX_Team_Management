import { useEffect, useState } from 'react';
import { api, messageOf } from '../services/api';
import { PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user } = useAuth();

  const [p, setP] = useState<any>(null);
  const [err, setErr] = useState('');

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
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function formatDate(date?: string) {
    if (!date) return '—';

    return new Date(date).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function getInitials() {
    if (!p) return 'WX';

    const first = p.first_name?.charAt(0) || '';
    const last = p.last_name?.charAt(0) || '';

    return `${first}${last}`.toUpperCase() || 'WX';
  }

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
            {/* Top Profile Section */}
            <div className="border-b border-slate-100 p-6 sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">

                {/* Profile Identity */}
                <div className="flex items-center gap-5">
                  {/* Avatar */}
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-navy text-2xl font-extrabold text-white shadow-sm">
                    {getInitials()}
                  </div>

                  <div>
                    <div className="mb-1 text-xs font-extrabold uppercase tracking-[0.18em] text-orange">
                      {p.user_type || 'Employee'}
                    </div>

                    <h2 className="text-2xl font-extrabold text-slate-900 sm:text-3xl">
                      {p.first_name} {p.last_name}
                    </h2>

                    <div className="mt-1 text-sm font-semibold text-slate-600">
                      {p.job_title || formatRole(p.role)}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {p.department_name && (
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
                          {p.department_name}
                        </span>
                      )}

                      <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700">
                        Active
                      </span>
                    </div>
                  </div>
                </div>

                {/* Employee Code */}
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

            {/* Information Section */}
            <div className="p-6 sm:p-8">
              <div className="grid gap-8 lg:grid-cols-2">

                {/* Contact Information */}
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
                    <div>
                      <div className="label">
                        Email / Login ID
                      </div>

                      <div className="mt-1 break-all text-sm font-semibold text-slate-900">
                        {p.email || '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Work Information */}
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
                        value={p.department_name || '—'}
                      />

                      <ProfileField
                        label="Team Lead"
                        value={p.team_lead_name || '—'}
                      />

                      <ProfileField
                        label="Job Title"
                        value={p.job_title || '—'}
                      />

                      <ProfileField
                        label="Joining Date"
                        value={formatDate(p.joining_date)}
                      />

                      <ProfileField
                        label="Employee Type"
                        value={
                          p.user_type
                            ? formatRole(p.user_type)
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
