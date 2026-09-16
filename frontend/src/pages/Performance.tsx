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
  const [showPerformanceRules, setShowPerformanceRules] = useState(false);

  const now = new Date();

  const [selectedMonth, setSelectedMonth] = useState(
    now.getMonth() + 1
  );

  const [selectedYear, setSelectedYear] = useState(
    now.getFullYear()
  );

  const safeNumber = (value: any, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const clampScore = (value: any) => {
    return Math.max(0, Math.min(100, safeNumber(value, 0)));
  };

  const load = async () => {
    try {
      const r = await api.get('/performance', {
        params: {
          month: selectedMonth,
          year: selectedYear,
          _ts: Date.now(),
        },
      });

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
  }, [selectedMonth, selectedYear]);

  async function calc(employeeId?: string) {
    try {
      setCalculating(true);
      setMsg('');

      const response = await api.post(
        '/performance/calculate',
        null,
        {
          params: {
            employeeId: employeeId || target || undefined,
            month: selectedMonth,
            year: selectedYear,
          },
        }
      );

      // Use the freshly calculated server response immediately
      // instead of waiting for a second GET /performance request.
      const calculated = response.data;

      if (Array.isArray(calculated?.scores)) {
        setRows(calculated.scores);
      } else if (calculated?.employee_id || calculated?.id) {
        setRows((previous) => {
          const incomingId = Number(calculated.employee_id);

          const existingIndex = previous.findIndex(
            (row) => Number(row.employee_id) === incomingId
          );

          if (existingIndex === -1) {
            return [calculated, ...previous];
          }

          const next = [...previous];
          next[existingIndex] = {
            ...next[existingIndex],
            ...calculated,
          };

          return next;
        });
      }

      // Re-read the list without cache after the calculation.
      await load();

      setMsg(
        'Performance recalculated successfully using task and attendance deductions.'
      );
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

      const response = await api.post(
        '/performance/calculate',
        null,
        {
          params: {
            month: selectedMonth,
            year: selectedYear,
          },
        }
      );

      // Apply newly calculated rows directly.
      if (Array.isArray(response.data?.scores)) {
        setRows(response.data.scores);
      }

      // Refresh from the server using a cache-busting query.
      await load();

      setMsg(
        'Performance recalculated successfully for all accessible employees using task and attendance deductions.'
      );
    } catch (e) {
      setMsg(messageOf(e));
    } finally {
      setCalculating(false);
    }
  }

  const orderedRows = useMemo(() => {
    if (!target) {
      return rows;
    }

    return [...rows].sort((a, b) => {
      const aSelected =
        String(a.employee_id) === String(target);

      const bSelected =
        String(b.employee_id) === String(target);

      if (aSelected && !bSelected) {
        return -1;
      }

      if (!aSelected && bSelected) {
        return 1;
      }

      return 0;
    });
  }, [rows, target]);

  return (
    <>
      <PageTitle
        title="Performance Management"
        subtitle="Performance is calculated using task performance, attendance performance, and applicable deductions"
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

      {user?.role === 'EMPLOYEE' && (
        <div className="card mb-5 flex flex-wrap items-center gap-3 p-4">
          <label className="text-sm font-bold text-slate-700">
            Month
          </label>

          <select
            className="input max-w-[180px]"
            value={selectedMonth}
            onChange={(e) =>
              setSelectedMonth(Number(e.target.value))
            }
          >
            {[
              'January',
              'February',
              'March',
              'April',
              'May',
              'June',
              'July',
              'August',
              'September',
              'October',
              'November',
              'December',
            ].map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>

          <label className="ml-2 text-sm font-bold text-slate-700">
            Year
          </label>

          <select
            className="input max-w-[120px]"
            value={selectedYear}
            onChange={(e) =>
              setSelectedYear(Number(e.target.value))
            }
          >
            {Array.from(
              { length: 6 },
              (_, index) => now.getFullYear() - index
            ).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      )}

      {user?.role !== 'EMPLOYEE' && (
        <div className="card mb-5 flex flex-wrap items-center gap-3 p-4">
          <select
            className="input max-w-[180px]"
            value={selectedMonth}
            onChange={(e) =>
              setSelectedMonth(Number(e.target.value))
            }
          >
            {[
              'January',
              'February',
              'March',
              'April',
              'May',
              'June',
              'July',
              'August',
              'September',
              'October',
              'November',
              'December',
            ].map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>

          <select
            className="input max-w-[120px]"
            value={selectedYear}
            onChange={(e) =>
              setSelectedYear(Number(e.target.value))
            }
          >
            {Array.from(
              { length: 6 },
              (_, index) => now.getFullYear() - index
            ).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>

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

      <div className="card mb-5 overflow-hidden p-0">
        <button
          type="button"
          onClick={() =>
            setShowPerformanceRules((previous) => !previous)
          }
          className="flex w-full items-center justify-between px-4 py-3 text-left font-extrabold text-black"
        >
          <span>Performance Rules</span>
          <span>{showPerformanceRules ? '−' : '+'}</span>
        </button>

        {showPerformanceRules && (
          <div className="border-t border-slate-200 px-4 py-3 text-sm text-black">
            <div className="space-y-1 leading-5">
              <div>
                <b>Task Performance:</b> average of all task scores
                for the selected month.
              </div>

              <div>
                <b>Attendance Performance:</b> calculated from the
                actual working days of the selected month.
              </div>

              <div>Sundays are excluded automatically.</div>

              <div>
                Daily attendance is proportional to the required
                working hours configured for that day.
              </div>

              <div>
                Approved <b>PAID leave</b> causes no attendance
                deduction.
              </div>

              <div>
                Other approved leave types still reduce attendance
                performance.
              </div>

              <div>
                A missed past working day is treated as absent.
              </div>
            </div>

            <div className="mt-3 border-t border-slate-200 pt-2 font-bold">
              Final Performance = 100% − Task Deduction − Attendance
              Deduction
            </div>
          </div>
        )}
      </div>

      {orderedRows.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orderedRows.map((r) => {
            const isSelected =
              user?.role !== 'EMPLOYEE' &&
              target !== '' &&
              String(r.employee_id) === String(target);

            const taskPerformance = clampScore(
  r.task_completion
);

const attendancePerformance = clampScore(
  r.attendance
);

const taskDeduction = clampScore(
  r.task_deduction !== undefined &&
    r.task_deduction !== null
    ? r.task_deduction
    : 100 - taskPerformance
);

const attendanceDeduction = clampScore(
  100 - attendancePerformance
);

const totalDeduction = clampScore(
  taskDeduction + attendanceDeduction
);

const score = clampScore(
  100 - totalDeduction
);

const metrics = [
  ['Task performance', taskPerformance],
  ['Attendance performance', attendancePerformance],
  ['Task deduction', taskDeduction],
  ['Attendance deduction', attendanceDeduction],
  ['Total deduction', totalDeduction],
  ['Final performance', score],
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
                      isSelected ? 'pt-8' : ''
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
                      Final performance
                    </div>
                  </div>

                  <div
                    className={
                      isSelected
                        ? `
                          grid
                          h-24
                          w-24
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
                          h-24
                          w-24
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
                    {score.toFixed(2)}%
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
                        {clampScore(value).toFixed(2)}%
                      </b>
                    </div>
                  ))}
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