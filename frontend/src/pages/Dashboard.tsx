import {useEffect,useState} from 'react';
import {api} from '../services/api';
import {PageTitle,StatCard} from '../components/UI';
import {useAuth} from '../context/AuthContext';
import {useNavigate} from 'react-router-dom';

export default function Dashboard(){
  const [d,setD]=useState<any>(null);
  const {user}=useAuth();
  const navigate=useNavigate();

  useEffect(()=>{void api.get('/dashboard').then(r=>setD(r.data))},[]);

  if(!d)return <div>Loading dashboard...</div>;

  if(user?.role==='EMPLOYEE')return <>
    <PageTitle title={`Welcome, ${user.name}`} subtitle="Your workday at a glance"/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <button type="button" onClick={()=>navigate('/tasks?status=PENDING')} className="text-left">
        <StatCard label="Assigned Tasks" value={d.tasks.total}/>
      </button>
      <button type="button" onClick={()=>navigate('/tasks?status=COMPLETED')} className="text-left">
        <StatCard label="Completed Tasks" value={d.tasks.completed}/>
      </button>
      <button type="button" onClick={()=>navigate('/tasks?status=OVERDUE')} className="text-left">
        <StatCard label="Overdue Tasks" value={d.tasks.overdue}/>
      </button>
      <button type="button" onClick={()=>navigate('/performance')} className="text-left">
        <StatCard label="Performance" value={d.performance?`${Number(d.performance.score).toFixed(1)}%`:'Not calculated'}/>
      </button>
    </div>
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <div className="section-title">Today's Attendance</div>
        <p className="mt-3 text-2xl font-extrabold">{d.todayAttendance?.status||'Not checked in'}</p>
        <p className="muted mt-1 text-sm">Mode: {d.todayAttendance?.attendance_mode||'—'}</p>
      </div>
      <div className="card p-5">
        <div className="section-title">Daily Reports</div>
        <p className="mt-3 text-3xl font-extrabold">{d.reports.submitted}</p>
        <p className="muted text-sm">Reports submitted this month</p>
      </div>
    </div>
  </>;

  return <>
    <PageTitle
      title={user?.role==='TEAM_LEAD'?'Team Lead Dashboard':'Company Dashboard'}
      subtitle={user?.role==='TEAM_LEAD'?'Only your supervised team is included':'Live operational overview from the connected database'}
    />

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <button type="button" onClick={()=>navigate('/employees')} className="text-left">
        <StatCard label="Total Users" value={d.employees.total}/>
      </button>
      <button type="button" onClick={()=>navigate('/employees?userType=EMPLOYEE')} className="text-left">
        <StatCard label="Employees" value={d.employees.employees}/>
      </button>
      <button type="button" onClick={()=>navigate('/employees?userType=INTERN')} className="text-left">
        <StatCard label="Interns" value={d.employees.interns}/>
      </button>
      <button type="button" className="text-left cursor-default">
        <StatCard label="Present Today" value={d.attendance.present}/>
      </button>
    </div>

    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <button type="button" onClick={()=>navigate('/tasks?status=PENDING')} className="text-left">
        <StatCard label="Pending Tasks" value={d.tasks.pending}/>
      </button>
      <button type="button" onClick={()=>navigate('/tasks?status=COMPLETED')} className="text-left">
        <StatCard label="Completed Tasks" value={d.tasks.completed}/>
      </button>
      <button type="button" onClick={()=>navigate('/tasks?status=OVERDUE')} className="text-left">
        <StatCard label="Overdue Tasks" value={d.tasks.overdue}/>
      </button>
      <button type="button" onClick={()=>navigate('/departments')} className="text-left">
        <StatCard label="Departments" value={d.departments.total}/>
      </button>
    </div>

    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <div className="section-title">Recent Activity</div>
        {d.recentActivity?.length?
          <div className="mt-4 space-y-3">
            {d.recentActivity.map((a:any)=>
              <div key={a.id} className="border-b pb-3 text-sm">
                <b>{a.action}</b> {a.entity_type}
                <div className="text-xs muted">{new Date(a.created_at).toLocaleString()}</div>
              </div>
            )}
          </div>
          :
          <p className="mt-3 text-sm muted">Team Leads see team data but not company-wide audit logs.</p>
        }
      </div>

      <div className="card p-5">
        <div className="section-title">Present Today</div>
        {d.presentToday?.length?
          <div className="mt-4 space-y-2">
            {d.presentToday.map((e:any)=>
              <div key={e.id} className="flex items-center justify-between border-b pb-3 last:border-b-0 last:pb-0">
                <div>
                  <div className="font-semibold">{e.employee_name}</div>
                  <div className="text-xs muted">{e.employee_code} · {e.user_type}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold">{e.status==='LATE'?'Late':'Present'}</div>
                  <div className="text-xs muted">
                    {e.check_in ? `In: ${new Date(e.check_in).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : 'No check-in time'}
                  </div>
                </div>
              </div>
            )}
          </div>
          :
          <p className="mt-3 text-sm muted">No employees are marked present today.</p>
        }
      </div>
    </div>
  </>;
}
