import {
  useEffect,
  useState
} from 'react';

import { api } from '../services/api';

import { PageTitle } from '../components/UI';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid
} from 'recharts';

function safeNumber(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeScore(value: any) {
  return Math.max(
    0,
    Math.min(100, safeNumber(value))
  );
}

export default function Analytics() {
  const [d, setD] = useState<any>(null);

  useEffect(() => {
    api
      .get('/analytics')
      .then(r => {
        const data = r.data || {};

        setD({
          departments: Array.isArray(data.departments)
            ? data.departments
            : [],

          tasks: Array.isArray(data.tasks)
            ? data.tasks
            : [],

          attendance: Array.isArray(data.attendance)
            ? data.attendance
            : [],

          performance: Array.isArray(data.performance)
            ? data.performance
            : []
        });
      });
  }, []);

  async function download(kind: string) {
    const r = await api.get(
      `/export/${kind}`,
      {
        responseType: 'blob'
      }
    );

    const u = URL.createObjectURL(r.data);

    const a = document.createElement('a');

    a.href = u;

    a.download = `withx-${kind}.csv`;

    a.click();

    URL.revokeObjectURL(u);
  }

  if (!d) {
    return <div>Loading analytics...</div>;
  }

  return (
    <>
      <PageTitle
        title="Reports & Analytics"
        subtitle="Management insights and CSV exports"
        action={
          <div className="flex flex-wrap gap-2">
            {[
              'employees',
              'attendance',
              'tasks',
              'performance'
            ].map(k => (
              <button
                key={k}
                onClick={() => download(k)}
                className="btn btn-primary capitalize"
              >
                Export {k}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-2">

        {/* Employees by Department */}
        <div className="card p-5">
          <div className="section-title">
            Employees by Department
          </div>

          <div className="mt-4 h-72">
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <BarChart data={d.departments}>
                <CartesianGrid strokeDasharray="3 3" />

                <XAxis dataKey="name" />

                <YAxis allowDecimals={false} />

                <Tooltip />

                <Bar
                  dataKey="employees"
                  fill="#0A192F"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 7-Day Attendance */}
        <div className="card p-5">
          <div className="section-title">
            7-Day Attendance
          </div>

          <div className="mt-4 h-72">
            <ResponsiveContainer
              width="100%"
              height="100%"
            >
              <LineChart data={d.attendance}>
                <CartesianGrid strokeDasharray="3 3" />

                <XAxis
                  dataKey="work_date"
                  tickFormatter={v =>
                    new Date(v).toLocaleDateString(
                      undefined,
                      {
                        month: 'short',
                        day: 'numeric'
                      }
                    )
                  }
                />

                <YAxis allowDecimals={false} />

                <Tooltip />

                <Line
                  dataKey="present"
                  stroke="#AC7D0C"
                  strokeWidth={3}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Task Status */}
        <div className="card p-5">
          <div className="section-title">
            Task Status
          </div>

          <div className="mt-4 space-y-3">
            {d.tasks.map((x: any) => (
              <div
                key={x.status}
                className="flex justify-between border-b pb-2"
              >
                <span>{x.status}</span>

                <b>
                  {safeNumber(x.count)}
                </b>
              </div>
            ))}
          </div>
        </div>

        {/* Top Performance */}
        <div className="card p-5">
          <div className="section-title">
            Top Performance Scores
          </div>

          <div className="mt-4 space-y-3">
            {d.performance.map(
              (x: any, index: number) => {
                const score = safeScore(x.score);

                return (
                  <div
                    key={`${x.employee_name}-${index}`}
                    className="flex justify-between border-b pb-2"
                  >
                    <span>
                      {x.employee_name ||
                        'Employee'}
                    </span>

                    <b>
                      {score.toFixed(1)}%
                    </b>
                  </div>
                );
              }
            )}
          </div>
        </div>
      </div>
    </>
  );
}