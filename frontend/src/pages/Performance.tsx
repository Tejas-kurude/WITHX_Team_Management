import { useEffect, useMemo, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, PageTitle } from '../components/UI';
import { useAuth } from '../context/AuthContext';

export default function Performance() {
  const { user } = useAuth();

  const [rows, setRows] = useState<any[]>([]);
  const [emps, setEmps] = useState<any[]>([]);
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');
  const [calculating, setCalculating] = useState(false);

  const safeNumber = (value: any, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const clampScore = (value: any) => {
    return Math.max(0, Math.min(100, safeNumber(value, 0)));
  };

  const load = async () => {
    try {
      const r = await api.get('/performance');
      setRows(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      setMsg(messageOf(e));
      setRows([]);
    }
  };

  useEffect(() => {
    load();

    if (user?.role !== 'EMPLOYEE') {
      api
        .get('/employees')
        .then((r) => {
          setEmps(Array.isArray(r.data) ? r.data : []);
        })
        .catch((e) => {
          setMsg(messageOf(e));
          setEmps([]);
        });
    }
  }, []);

  async function calc(employeeId?: string) {
    try {
      setCalculating(true);
      setMsg('');

      await api.post('/performance/calculate', null, {
        params: {
          employeeId: employeeId || target || undefined,
        },
      });

      setMsg('Performance recalculated successfully.');
      await load();
    } catch (e) {
      setMsg(messageOf(e));
    } finally {
      setCalculating(false);
    }
  }

  async function calcAll() {
    try {
      setCalculating(true);
      setMsg('');

      await api.post('/performance/calculate');

      setMsg(
        'Performance recalculated successfully for all accessible employees.'
      );

      await load();
    } catch (e) {
      setMsg(messageOf(e));
    } finally {
      setCalculating(false);
    }
  }

  const orderedRows = useMemo(() => {
    if (!target) return rows;

    return [...rows].sort((a, b) => {
      const aSelected =
        String(a.employee_id) === String(target);

      const bSelected =
        String(b.employee_id) === String(target);

      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;

      return 0;
    });
  }, [rows, target]);

  return (
    <>
      <PageTitle
        title="Performance Management"
        subtitle="Automatic score: task completion 35% + on-time completion 25% + attendance 20% + working hours 20%"
        action={
          user?.role === 'EMPLOYEE' ? (
            <button
              className="btn btn-accent"
              disabled={calculating}
              onClick={() => calc()}
            >
              {calculating
                ? 'Calculating...'
                : 'Recalculate My Score'}
            </button>
          ) : undefined
        }
      />

      {user?.role !== 'EMPLOYEE' && (
        <div className="card mb-5 flex flex-wrap items-center gap-3 p-4">
          <select
            className="input max-w-sm"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Select employee</option>

            {emps.map((e) => (
              <option key={e.id} value={e.id}>
                {e.first_name} {e.last_name}
              </option>
            ))}
          </select>

          <button
            className="btn btn-primary"
            disabled={!target || calculating}
            onClick={() => calc()}
          >
            {calculating && target
              ? 'Calculating...'
              : 'Calculate Performance'}
          </button>

          <button
            className="btn btn-accent"
            disabled={calculating}
            onClick={calcAll}
          >
            {calculating && !target
              ? 'Calculating...'
              : 'Recalculate All'}
          </button>
        </div>
      )}

      {msg && (
        <div className="mb-4 rounded-lg bg-white p-3 text-sm">
          {msg}
        </div>
      )}

      {orderedRows.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orderedRows.map((r) => {
            const isSelected =
              user?.role !== 'EMPLOYEE' &&
              target !== '' &&
              String(r.employee_id) === String(target);

            const score = clampScore(r.score);

            const metrics = [
              ['Task completion', r.task_completion],
              ['On-time completion', r.on_time],
              ['Attendance', r.attendance],
              ['Working hours', r.working_hours],
            ];

            return (
              <div
                key={r.id}
                className={
                  isSelected
                    ? `
                      card
                      relative
                      z-50
                      -translate-y-3
                      !border-2
                      !border-cyan-500
                      !border-solid
                      bg-cyan-50
                      shadow-[0_0_0_1px_rgba(6,182,212,0.20),0_18px_40px_rgba(6,182,212,0.22)]
                      transition-all
                      duration-300
                      p-5
                    `
                    : `
                      card
                      relative
                      z-0
                      translate-y-0
                      !border
                      !border-black
                      !border-solid
                      bg-white
                      text-black
                      shadow-none
                      transition-all
                      duration-300
                      p-5
                    `
                }
              >
                {/* Selected tag - positioned in the open space on the left */}
                {isSelected && (
                  <div className="absolute left-5 top-5">
                    <span className="rounded-full bg-cyan-500 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-sm">
                      Selected
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4">
                  <div
                    className={
                      isSelected
                        ? 'pt-8'
                        : ''
                    }
                  >
                    <h3 className="font-extrabold text-black">
                      {r.employee_name || user?.name}
                    </h3>

                    <div
                      className={
                        isSelected
                          ? 'mt-1 text-xs text-cyan-700'
                          : 'mt-1 text-xs text-black'
                      }
                    >
                      Last 30-day score
                    </div>
                  </div>

                  {/* Percentage circle */}
                  <div
                    className={
                      isSelected
                        ? `
                          grid
                          h-16
                          w-16
                          shrink-0
                          place-items-center
                          rounded-full
                          border-4
                          border-cyan-500
                          bg-white
                          text-lg
                          font-extrabold
                          text-cyan-600
                          shadow-sm
                        `
                        : `
                          grid
                          h-16
                          w-16
                          shrink-0
                          place-items-center
                          rounded-full
                          border-4
                          border-black
                          bg-white
                          text-lg
                          font-extrabold
                          text-black
                          shadow-none
                        `
                    }
                  >
                    {score.toFixed(0)}%
                  </div>
                </div>

                <div className="mt-5 space-y-2 text-sm">
                  {metrics.map(([key, value]) => (
                    <div
                      className={
                        isSelected
                          ? 'flex justify-between border-b border-cyan-100 pb-2 last:border-b-0'
                          : 'flex justify-between border-b border-slate-200 pb-2 last:border-b-0'
                      }
                      key={String(key)}
                    >
                      <span
                        className={
                          isSelected
                            ? 'text-slate-700'
                            : 'text-black'
                        }
                      >
                        {key}
                      </span>

                      <b
                        className={
                          isSelected
                            ? 'text-cyan-700'
                            : 'text-black'
                        }
                      >
                        {clampScore(value).toFixed(1)}%
                      </b>
                    </div>
                  ))}
                </div>

                <div
                  className={
                    isSelected
                      ? `
                        mt-4
                        rounded-lg
                        border
                        border-cyan-100
                        bg-white
                        p-3
                        text-xs
                        text-slate-600
                      `
                      : `
                        mt-4
                        rounded-lg
                        border
                        border-black
                        bg-white
                        p-3
                        text-xs
                        text-black
                      `
                  }
                >
                  Working-hours score reaches 100% at the configured minimum
                  (default 3 hours/day) and is capped there.
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty>No performance scores calculated yet.</Empty>
      )}
    </>
  );
}