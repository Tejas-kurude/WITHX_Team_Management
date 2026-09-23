import {FormEvent,useEffect,useState} from 'react';
import {api,messageOf} from '../services/api';
import {PageTitle} from '../components/UI';

export default function Settings(){
  const [s,setS]=useState<any>({}),[msg,setMsg]=useState(''),[err,setErr]=useState('');

  useEffect(()=>{
    void api.get('/settings')
      .then(r=>setS(r.data))
      .catch(e=>setErr(messageOf(e)))
  },[]);

  async function save(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setMsg('');
    setErr('');
    try{
      const body=Object.fromEntries(new FormData(e.currentTarget).entries());
      await api.put('/settings',body);
      setS({...s,...body});
      setMsg('System and performance settings saved.');
    }catch(e){
      setErr(messageOf(e))
    }
  }

  function useCurrentLocation(){
    setErr('');
    setMsg('');
    if(!navigator.geolocation){
      setErr('Geolocation is not supported by this browser.');
      return
    }
    navigator.geolocation.getCurrentPosition(
      p=>{
        setS((v:any)=>({
          ...v,
          office_latitude:String(p.coords.latitude),
          office_longitude:String(p.coords.longitude)
        }));
        setMsg('Current device coordinates captured. Review them before saving as the company location.')
      },
      e=>setErr(`Location error: ${e.message}`),
      {enableHighAccuracy:true,timeout:15000}
    )
  }

  return <>
    <PageTitle
      title="System Settings"
      subtitle="Company location, attendance configuration and performance calculation rules"
    />

    <div className="card max-w-4xl p-6">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={save}>
        <div className="sm:col-span-2">
          <label className="label">Company Name</label>
          <input className="input mt-1" name="company_name" value={s.company_name||''} onChange={e=>setS({...s,company_name:e.target.value})}/>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Office Address</label>
          <textarea className="input mt-1 min-h-20" name="office_address" value={s.office_address||''} onChange={e=>setS({...s,office_address:e.target.value})}/>
        </div>
        <div>
          <label className="label">Office Latitude</label>
          <input className="input mt-1" name="office_latitude" value={s.office_latitude||''} onChange={e=>setS({...s,office_latitude:e.target.value})}/>
        </div>
        <div>
          <label className="label">Office Longitude</label>
          <input className="input mt-1" name="office_longitude" value={s.office_longitude||''} onChange={e=>setS({...s,office_longitude:e.target.value})}/>
        </div>
        <div className="sm:col-span-2">
          <button type="button" className="btn" onClick={useCurrentLocation}>Use This Device's Current Location</button>
        </div>
        <div>
          <label className="label">Allowed GPS Radius (m)</label>
          <input className="input mt-1" type="number" min="20" name="geofence_radius_m" value={s.geofence_radius_m||300} onChange={e=>setS({...s,geofence_radius_m:e.target.value})}/>
        </div>
        <div>
          <label className="label">Late After</label>
          <input className="input mt-1" type="time" name="late_after_time" value={s.late_after_time||'10:15'} onChange={e=>setS({...s,late_after_time:e.target.value})}/>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Minimum Work Duration (minutes)</label>
          <input className="input mt-1" type="number" min="1" name="minimum_work_minutes" value={s.minimum_work_minutes||180} onChange={e=>setS({...s,minimum_work_minutes:e.target.value})}/>
        </div>

        <div className="sm:col-span-2 rounded-2xl border border-cyan-200 bg-cyan-50 p-5">
          <h2 className="text-base font-extrabold text-cyan-950">Performance Calculation Rules</h2>
          <p className="mt-1 text-sm text-cyan-900">
            Attendance uses exact minutes. Task performance is calculated independently. Final deduction is attendance deduction + task deduction.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Total Working Days</label>
              <input className="input mt-1" type="number" min="1" name="performance_total_working_days" value={s.performance_total_working_days||26} onChange={e=>setS({...s,performance_total_working_days:e.target.value})}/>
            </div>
            <div>
              <label className="label">Default Daily Required Minutes</label>
              <input className="input mt-1" type="number" min="1" step="0.01" name="performance_default_daily_required_minutes" value={s.performance_default_daily_required_minutes||180} onChange={e=>setS({...s,performance_default_daily_required_minutes:e.target.value})}/>
            </div>
            <div>
              <label className="label">Task Deadline (days)</label>
              <input className="input mt-1" type="number" min="0" name="performance_task_deadline_days" value={s.performance_task_deadline_days||5} onChange={e=>setS({...s,performance_task_deadline_days:e.target.value})}/>
            </div>
            <div>
              <label className="label">Late Task Deduction / Extra Day (%)</label>
              <input className="input mt-1" type="number" min="0" max="100" step="0.01" name="performance_task_late_deduction_per_day" value={s.performance_task_late_deduction_per_day||20} onChange={e=>setS({...s,performance_task_late_deduction_per_day:e.target.value})}/>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-cyan-100 bg-white/70 p-3 text-xs text-cyan-950">
            Defaults: 26 working days, 180 minutes/day, 5 task days, 20% per extra task day. Saturday has no automatic 6-hour rule.
          </div>
        </div>

        <div className="sm:col-span-2 rounded-xl bg-slate-50 p-4 text-sm muted">
          Admin and Super Admin can update the company location. Offline attendance uses browser/device GPS and the configured geofence.
        </div>

        {msg&&<div className="sm:col-span-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</div>}
        {err&&<div className="sm:col-span-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}

        <button className="btn btn-primary sm:col-span-2">Save Settings</button>
      </form>
    </div>
  </>
}
