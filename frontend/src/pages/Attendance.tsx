import {useEffect,useState} from 'react';
import {api,messageOf} from '../services/api';
import {Empty,PageTitle} from '../components/UI';
import {useAuth} from '../context/AuthContext';
import {useSearchParams} from 'react-router-dom';

function modeClass(mode?:string){
  const m=String(mode||'').toUpperCase();
  if(m==='ONLINE') return 'border border-blue-200 bg-blue-50 text-blue-700';
  if(m==='OFFLINE') return 'border border-slate-300 bg-slate-100 text-slate-700';
  return 'border border-slate-200 bg-white text-slate-700';
}

function statusClass(status?:string){
  const s=String(status||'').toUpperCase();
  if(s==='PRESENT') return 'border border-green-200 bg-green-50 text-green-700';
  if(s==='LATE') return 'border border-amber-200 bg-amber-50 text-amber-800';
  if(s==='LEAVE') return 'border border-rose-200 bg-rose-50 text-rose-700';
  return 'border border-slate-200 bg-slate-100 text-slate-700';
}

function formatDuration(hours:any, checkIn?:string, checkOut?:string){
  if(checkIn && !checkOut && (hours === null || hours === undefined || hours === '')) return 'In progress';
  const n=Number(hours);
  if(!Number.isFinite(n) || n<0) return '—';
  const minutes=Math.round(n*60);
  return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}

export default function Attendance(){
  const {user}=useAuth();
  const [searchParams]=useSearchParams();
  const [today,setToday]=useState<any>(null),[rows,setRows]=useState<any[]>([]),[msg,setMsg]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[mode,setMode]=useState<'ONLINE'|'OFFLINE'>('OFFLINE'),[search,setSearch]=useState(''),[actionLoading,setActionLoading]=useState('');
  const onApprovedLeave=String(today?.status||'').toUpperCase()==='LEAVE';

  const statusFilter=searchParams.get('status')||'';
  const dateFilter=searchParams.get('date')||'';

  async function load(q=search){
    try{
      setErr('');
      const [a,b]=await Promise.all([
        api.get('/attendance/today'),
        api.get('/attendance',{params:{search:q||undefined,status:statusFilter||undefined,date:dateFilter||undefined}})
      ]);
      setToday(a.data);
      setRows(Array.isArray(b.data)?b.data:[]);
      if(a.data?.attendance_mode)setMode(a.data.attendance_mode);
    }catch(e){setErr(messageOf(e))}
  }

  useEffect(()=>{void load('')},[]);
  useEffect(()=>{
    const t=setTimeout(()=>void load(search),250);
    return()=>clearTimeout(t)
  },[search,statusFilter,dateFilter]);

  // Keep worked-hours data current while the employee is checked in.
  useEffect(()=>{
    if(!today?.check_in || today?.check_out) return;
    const timer=window.setInterval(()=>void load(search),60000);
    return()=>window.clearInterval(timer);
  },[today?.check_in,today?.check_out,search,statusFilter,dateFilter]);

  async function send(action:'check-in'|'check-out',payload:any){
    try{
      await api.post(`/attendance/${action}`,payload);
      setMsg(action==='check-in'?'Attendance marked successfully.':'Checked out successfully.');
      await load();
    }catch(e){setErr(messageOf(e))}
    finally{setBusy(false);setActionLoading('')}
  }

  function mark(action:'check-in'|'check-out'){
    setMsg('');setErr('');
    if(action==='check-in' && onApprovedLeave){
      setErr('Check-in is not allowed today because you are on approved leave.');
      return;
    }
    setBusy(true);
    setActionLoading(action==='check-in'?'Checking you in…':'Checking you out…');
    const effectiveMode=today?.attendance_mode||mode;
    if(effectiveMode==='ONLINE'){void send(action,{mode:'ONLINE'});return}
    if(!navigator.geolocation){setErr('Geolocation is not supported by this browser.');setBusy(false);return}
    navigator.geolocation.getCurrentPosition(
      p=>void send(action,{mode:'OFFLINE',latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}),
      e=>{setErr(`Location permission/error: ${e.message}`);setBusy(false);setActionLoading('')},
      {enableHighAccuracy:true,timeout:15000,maximumAge:0}
    );
  }

  return <>
    <PageTitle title="Attendance Management" subtitle="Choose Online or Offline; Offline captures your current device location"/>

    {user?.employeeId&&
      <div className="card mb-6 p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#D8C8B5] bg-[#F8F3ED] px-5 py-4 shadow-sm">
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#18263F]">
              Today's Working Hours
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-600">
              Required working hours for today
            </div>
          </div>
          <div className="rounded-xl border border-[#18263F] bg-[#18263F] px-4 py-2 text-base font-extrabold text-white shadow-sm">
            ~ {formatDuration(today?.required_work_hours ?? 3)}
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="label">Attendance Mode</div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={!!today?.check_in||onApprovedLeave}
                onClick={()=>setMode('ONLINE')}
                className={`inline-flex min-w-[104px] items-center justify-center rounded-xl border px-5 py-2.5 text-sm font-extrabold leading-none transition-all ${
                  mode==='ONLINE'
                    ? 'border-[#18263F] bg-[#18263F] text-white shadow-md'
                    : 'border-[#D8C8B5] bg-[#F5EDE3] text-[#18263F] hover:border-[#BBA58D] hover:bg-[#EDE1D3]'
                } ${today?.check_in?'cursor-not-allowed opacity-50':''}`}
              >
                Online
              </button>
              <button
                type="button"
                disabled={!!today?.check_in||onApprovedLeave}
                onClick={()=>setMode('OFFLINE')}
                className={`inline-flex min-w-[104px] items-center justify-center rounded-xl border px-5 py-2.5 text-sm font-extrabold leading-none transition-all ${
                  mode==='OFFLINE'
                    ? 'border-[#18263F] bg-[#18263F] text-white shadow-md'
                    : 'border-[#D8C8B5] bg-[#F5EDE3] text-[#18263F] hover:border-[#BBA58D] hover:bg-[#EDE1D3]'
                } ${today?.check_in?'cursor-not-allowed opacity-50':''}`}
              >
                Offline
              </button>
            </div>
            <p className="mt-2 text-xs muted">Online: remote attendance without GPS. Offline: browser location permission is required and your position must be inside the configured company radius.</p>
          </div>

          <div>
            <div className="text-sm muted">Today's Status</div>
            <div className="mt-1 text-2xl font-extrabold">{today?.status||'Not checked in'}</div>
            <div className="mt-1 text-xs muted">Mode: {today?.attendance_mode||mode} {today?.location_verified?'• GPS verified':''}</div>
            {onApprovedLeave&&<div className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">You are on approved leave today. Check-in is disabled for the duration of your approved leave.</div>}
            {today?.check_in&&
              <div className="mt-1 text-xs muted">
                Work duration: {formatDuration(today?.worked_hours ?? today?.total_hours,today?.check_in,today?.check_out)}
              </div>
            }

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy||!!today?.check_in||onApprovedLeave}
                onClick={()=>mark('check-in')}
                className="inline-flex min-w-[132px] items-center justify-center gap-2 rounded-xl border border-[#B8862C] bg-[#D6A94A] px-5 py-2.5 text-sm font-extrabold leading-none text-[#171717] shadow-md transition-all hover:bg-[#C99B3D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading === 'Checking you in…' && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                )}
                {actionLoading === 'Checking you in…' ? 'Checking In…' : 'Check In'}
              </button>

              <button
                type="button"
                disabled={busy||!today?.check_in||!!today?.check_out}
                onClick={()=>mark('check-out')}
                className="inline-flex min-w-[132px] items-center justify-center gap-2 rounded-xl border border-[#1B1B1B] bg-[#1B1B1B] px-5 py-2.5 text-sm font-extrabold leading-none text-white shadow-md transition-all hover:bg-[#2A2A2A] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading === 'Checking you out…' && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
                )}
                {actionLoading === 'Checking you out…' ? 'Checking Out…' : 'Check Out'}
              </button>
            </div>

            {actionLoading && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#D8C8B5] bg-[#F8F3ED] px-3 py-2 text-xs font-semibold text-[#18263F]">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#CDBBA8] border-t-[#18263F]" />
                {actionLoading} Please wait while the attendance service responds.
              </div>
            )}
          </div>
        </div>

        {msg&&<div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</div>}
        {err&&<div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      </div>
    }

    <div className="card mb-4 p-4">
      <label className="label">Search Attendance</label>
      <input className="input mt-1" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, employee ID, department, mode or status..."/>
    </div>

    {rows.length?
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              {user?.role!=='EMPLOYEE'&&<><th>ID</th><th>User</th></>}
              <th>Mode</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Working Hours</th>
              <th>Work Duration</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r=>
              <tr key={r.id}>
                <td>{new Date(r.work_date).toLocaleDateString()}</td>
                {user?.role!=='EMPLOYEE'&&
                  <>
                    <td><b>{r.employee_code}</b><div className="text-xs muted">User #{r.user_id||'—'}</div></td>
                    <td>{r.employee_name}<div className="text-xs muted">{r.user_type} • {r.department_name||'No department'}</div></td>
                  </>
                }
                <td><span className={`badge ${modeClass(r.attendance_mode)}`}>{r.attendance_mode}</span></td>
                <td>{r.check_in?new Date(r.check_in).toLocaleTimeString():'—'}</td>
                <td>
                  {r.check_out
                    ? new Date(r.check_out).toLocaleTimeString()
                    : r.checkout_missed
                      ? <span className="font-extrabold text-red-600">Half Day • Checkout missed</span>
                      : '—'}
                </td>
                <td>{formatDuration(r.required_work_hours)}</td>
                <td className={r.check_in&&!r.check_out?'text-amber-700 font-semibold':''}>
                  {formatDuration(r.worked_hours ?? r.total_hours,r.check_in,r.check_out)}
                </td>
                <td className="max-w-xs whitespace-normal text-xs">{r.location_text||'—'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      :<Empty/>
    }
  </>
}
