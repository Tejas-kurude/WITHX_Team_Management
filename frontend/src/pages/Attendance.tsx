import {useEffect,useState} from 'react';
import {api,messageOf} from '../services/api';
import {Empty,PageTitle} from '../components/UI';
import {useAuth} from '../context/AuthContext';

function formatDuration(hours:any, checkIn?:string, checkOut?:string){
  if(checkIn && !checkOut) return 'Check-out missing';
  const n=Number(hours);
  if(!Number.isFinite(n) || n<=0) return '—';
  const minutes=Math.round(n*60);
  return `${Math.floor(minutes/60)}h ${minutes%60}m`;
}

export default function Attendance(){
  const {user}=useAuth();
  const [today,setToday]=useState<any>(null),[rows,setRows]=useState<any[]>([]),[msg,setMsg]=useState(''),[err,setErr]=useState(''),[busy,setBusy]=useState(false),[mode,setMode]=useState<'ONLINE'|'OFFLINE'>('OFFLINE'),[search,setSearch]=useState('');
  async function load(q=search){try{setErr('');const [a,b]=await Promise.all([api.get('/attendance/today'),api.get('/attendance',{params:{search:q||undefined}})]);setToday(a.data);setRows(b.data);if(a.data?.attendance_mode)setMode(a.data.attendance_mode)}catch(e){setErr(messageOf(e))}}
  useEffect(()=>{void load('')},[]);
  useEffect(()=>{const t=setTimeout(()=>void load(search),250);return()=>clearTimeout(t)},[search]);
  async function send(action:'check-in'|'check-out',payload:any){try{await api.post(`/attendance/${action}`,payload);setMsg(action==='check-in'?'Attendance marked successfully.':'Checked out successfully.');await load()}catch(e){setErr(messageOf(e))}finally{setBusy(false)}}
  function mark(action:'check-in'|'check-out'){
    setMsg('');setErr('');setBusy(true);
    const effectiveMode=today?.attendance_mode||mode;
    if(effectiveMode==='ONLINE'){void send(action,{mode:'ONLINE'});return}
    if(!navigator.geolocation){setErr('Geolocation is not supported by this browser.');setBusy(false);return}
    navigator.geolocation.getCurrentPosition(p=>void send(action,{mode:'OFFLINE',latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}),e=>{setErr(`Location permission/error: ${e.message}`);setBusy(false)},{enableHighAccuracy:true,timeout:15000,maximumAge:0});
  }
  return <><PageTitle title="Attendance Management" subtitle="Choose Online or Offline; Offline captures your current device location"/>{user?.employeeId&&<div className="card mb-6 p-6"><div className="grid gap-5 lg:grid-cols-2"><div><div className="label">Attendance Mode</div><div className="mt-2 flex gap-2"><button disabled={!!today?.check_in} onClick={()=>setMode('ONLINE')} className={`btn ${mode==='ONLINE'?'btn-accent':''}`}>Online</button><button disabled={!!today?.check_in} onClick={()=>setMode('OFFLINE')} className={`btn ${mode==='OFFLINE'?'btn-accent':''}`}>Offline</button></div><p className="mt-2 text-xs muted">Online: remote attendance without GPS. Offline: browser location permission is required and your position must be inside the configured company radius.</p></div><div><div className="text-sm muted">Today's Status</div><div className="mt-1 text-2xl font-extrabold">{today?.status||'Not checked in'}</div><div className="mt-1 text-xs muted">Mode: {today?.attendance_mode||mode} {today?.location_verified?'• GPS verified':''}</div>{today?.check_in&&<div className="mt-1 text-xs muted">Work duration: {formatDuration(today?.total_hours,today?.check_in,today?.check_out)}</div>}<div className="mt-4 flex gap-2"><button disabled={busy||!!today?.check_in} onClick={()=>mark('check-in')} className="btn btn-accent">Check In</button><button disabled={busy||!today?.check_in||!!today?.check_out} onClick={()=>mark('check-out')} className="btn btn-primary">Check Out</button></div></div></div>{msg&&<div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</div>}{err&&<div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}</div>}
  <div className="card mb-4 p-4"><label className="label">Search Attendance</label><input className="input mt-1" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, employee ID, department, mode or status..."/></div>
  {rows.length?<div className="table-wrap"><table className="table"><thead><tr><th>Date</th>{user?.role!=='EMPLOYEE'&&<><th>ID</th><th>User</th></>}<th>Mode</th><th>Status</th><th>Check In</th><th>Check Out</th><th>Work Duration</th><th>Location</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{new Date(r.work_date).toLocaleDateString()}</td>{user?.role!=='EMPLOYEE'&&<><td><b>{r.employee_code}</b><div className="text-xs muted">User #{r.user_id||'—'}</div></td><td>{r.employee_name}<div className="text-xs muted">{r.user_type} • {r.department_name||'No department'}</div></td></>}<td><span className="badge">{r.attendance_mode}</span></td><td><span className="badge">{r.status}</span></td><td>{r.check_in?new Date(r.check_in).toLocaleTimeString():'—'}</td><td>{r.check_out?new Date(r.check_out).toLocaleTimeString():'—'}</td><td className={r.check_in&&!r.check_out?'text-amber-700 font-semibold':''}>{formatDuration(r.total_hours,r.check_in,r.check_out)}</td><td className="max-w-xs whitespace-normal text-xs">{r.location_text||'—'}</td></tr>)}</tbody></table></div>:<Empty/>}</>
}
