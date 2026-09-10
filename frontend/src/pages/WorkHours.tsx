import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, messageOf } from '../services/api';
import { Empty, PageTitle } from '../components/UI';

const scopeLabels: Record<string, string> = {
  DEFAULT: 'Default',
  DEPARTMENT: 'Department',
  TEAM: 'Team',
  EMPLOYEE: 'Individual',
};

const scopePriority = ['DEFAULT', 'DEPARTMENT', 'TEAM', 'EMPLOYEE'];

export default function WorkHours() {
  const [rows, setRows] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [scope, setScope] = useState('DEFAULT');
  const [scopeId, setScopeId] = useState('');
  const [hours, setHours] = useState('3');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function load() {
    try {
      setErr('');
      const [wh, emp, dep] = await Promise.all([
        api.get('/work-hours'),
        api.get('/employees'),
        api.get('/departments'),
      ]);
      setRows(Array.isArray(wh.data) ? wh.data : []);
      setEmployees(Array.isArray(emp.data) ? emp.data : []);
      setDepartments(Array.isArray(dep.data) ? dep.data : []);
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const teamLeads = useMemo(
    () => employees.filter((e) => e.role === 'TEAM_LEAD'),
    [employees]
  );

  function resetForm() {
    setScope('DEFAULT');
    setScopeId('');
    setHours('3');
    setEditingId(null);
  }

  function editRow(row: any) {
    setScope(row.scope);
    setScopeId(row.scope === 'DEFAULT' ? '' : String(row.scope_id ?? ''));
    setHours(String(row.hours ?? '3'));
    setEditingId(Number(row.id));
    setMsg('');
    setErr('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      setErr('');
      setMsg('');
      await api.post('/work-hours', {
        scope,
        scopeId: scope === 'DEFAULT' ? null : Number(scopeId),
        hours: Number(hours),
      });
      setMsg(editingId ? 'Work hours updated successfully.' : 'Work hours saved successfully.');
      resetForm();
      await load();
    } catch (e) {
      setErr(messageOf(e));
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: number) {
    try {
      setErr('');
      setMsg('');
      await api.delete(`/work-hours/${id}`);
      if (editingId === id) resetForm();
      setMsg('Override removed. The target will inherit the next available work-hours rule.');
      await load();
    } catch (e) {
      setErr(messageOf(e));
    }
  }

  function targetOptions() {
    if (scope === 'DEPARTMENT') {
      return departments.map((d) => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ));
    }
    if (scope === 'TEAM') {
      return teamLeads.map((e) => (
        <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>
      ));
    }
    return employees.map((e) => (
      <option key={e.id} value={e.id}>{e.employee_code} — {e.first_name} {e.last_name}</option>
    ));
  }

  const orderedRows = [...rows].sort((a, b) => {
    const sa = scopePriority.indexOf(a.scope);
    const sb = scopePriority.indexOf(b.scope);
    if (sa !== sb) return sa - sb;
    return String(a.target_name || '').localeCompare(String(b.target_name || ''));
  });

  return (
    <>
      <PageTitle
        title="Work Hours"
        subtitle="Configure required daily working hours by default, department, team or individual."
      />

      {err && <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{err}</div>}
      {msg && <div className="mb-4 rounded-xl bg-white p-4 text-sm font-semibold text-emerald-700">{msg}</div>}

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <form onSubmit={save} className="card h-fit p-5">
          <div className="mb-5">
            <h2 className="text-lg font-extrabold text-navy">
              {editingId ? 'Edit Work Hours' : 'Set Work Hours'}
            </h2>
            <p className="mt-1 text-sm muted">Individual settings override team, department and default settings.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-bold">Applies To</label>
              <select className="input w-full" value={scope} onChange={(e) => { setScope(e.target.value); setScopeId(''); }}>
                <option value="DEFAULT">Default — Everyone</option>
                <option value="DEPARTMENT">Department</option>
                <option value="TEAM">Team</option>
                <option value="EMPLOYEE">Individual Employee</option>
              </select>
            </div>

            {scope !== 'DEFAULT' && (
              <div>
                <label className="mb-1.5 block text-sm font-bold">
                  {scope === 'DEPARTMENT' ? 'Department' : scope === 'TEAM' ? 'Team Lead / Team' : 'Employee'}
                </label>
                <select className="input w-full" value={scopeId} onChange={(e) => setScopeId(e.target.value)} required>
                  <option value="">Select {scope === 'DEPARTMENT' ? 'department' : scope === 'TEAM' ? 'team' : 'employee'}</option>
                  {targetOptions()}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-bold">Required Work Hours / Day</label>
              <div className="flex items-center gap-2">
                <input
                  className="input w-full"
                  type="number"
                  min="0.25"
                  max="24"
                  step="0.25"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  required
                />
                <span className="text-sm font-semibold muted">hours</span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Saving...' : editingId ? 'Update Hours' : 'Save Hours'}
            </button>
            {editingId && (
              <button className="btn" type="button" onClick={resetForm}>Cancel</button>
            )}
          </div>
        </form>

        <div className="card p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-navy">Configured Rules</h2>
              <p className="mt-1 text-sm muted">Priority: Individual → Team → Department → Default.</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-700">
              Default: {Number(rows.find((r) => r.scope === 'DEFAULT')?.hours ?? 3).toFixed(2)} hrs/day
            </div>
          </div>

          {orderedRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-3">Scope</th>
                    <th className="px-3 py-3">Target</th>
                    <th className="px-3 py-3">Required Hours</th>
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-3 py-3 font-bold text-navy">{scopeLabels[row.scope] || row.scope}</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-800">{row.target_name}</div>
                        {row.scope === 'DEFAULT' && <div className="text-xs muted">Fallback for everyone without an override</div>}
                      </td>
                      <td className="px-3 py-3 font-extrabold text-cyan-700">{Number(row.hours).toFixed(2)} hrs/day</td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button type="button" className="btn !px-3 !py-1.5" onClick={() => editRow(row)}>Edit</button>
                          {row.scope !== 'DEFAULT' && (
                            <button type="button" className="btn !px-3 !py-1.5 !text-red-600" onClick={() => void remove(Number(row.id))}>Remove</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>No work-hours settings found.</Empty>
          )}
        </div>
      </div>
    </>
  );
}
