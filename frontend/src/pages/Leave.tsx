import {FormEvent,useEffect,useState} from 'react';
import {api,messageOf} from '../services/api';
import {Empty,Modal,PageTitle} from '../components/UI';
import {useAuth} from '../context/AuthContext';

export default function Leave(){
  const {user}=useAuth();const isSuper=user?.role==='SUPER_ADMIN';const canApprove=user?.role==='SUPER_ADMIN'||user?.role==='ADMIN';
  const [rows,setRows]=useState<any[]>([]),[show,setShow]=useState(false),[editing,setEditing]=useState<any|null>(null),[err,setErr]=useState(''),[pageErr,setPageErr]=useState(''),[decision,setDecision]=useState<{id:number;status:string}|null>(null),[comment,setComment]=useState('');
  async function load(){try{setPageErr('');const r=await api.get('/leave');setRows(r.data)}catch(e){setPageErr(messageOf(e))}}
  useEffect(()=>{void load()},[]);
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setErr('');try{const body:any=Object.fromEntries(new FormData(e.currentTarget).entries());if(body.startDate&&body.endDate&&String(body.endDate)<String(body.startDate)){setErr('To Date cannot be earlier than From Date.');return}if(editing)await api.put(`/leave/${editing.id}`,body);else await api.post('/leave',body);setShow(false);setEditing(null);await load()}catch(e){setErr(messageOf(e))}}
  async function decide(id:number,status:string){try{const comment=prompt(`Optional comment for ${status.toLowerCase()}:`)||'';await api.put(`/leave/${id}/decision`,{status,comment});await load()}catch(e){alert(messageOf(e))}}
  async function remove(id:number){if(!confirm('Delete this leave request?'))return;try{await api.delete(`/leave/${id}`);await load()}catch(e){alert(messageOf(e))}}
  return <><PageTitle title="Leave Management" subtitle="Apply, review and track leave requests" action={<button className="btn btn-accent" onClick={()=>{setEditing(null);setShow(true)}}>+ Apply Leave</button>}/>
  {pageErr&&<div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{pageErr}</div>}
  {rows.length?<div className="table-wrap"><table className="table"><thead><tr>{user?.role!=='EMPLOYEE'&&<th>Employee</th>}<th>Type</th><th>Dates</th><th>Reason</th><th>Status</th>{canApprove&&<th>Approval</th>}{isSuper&&<th>Manage</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.id}>{user?.role!=='EMPLOYEE'&&<td><b>{r.employee_name}</b><div className="text-xs text-orange">{r.employee_code} • {r.user_type}</div><div className="text-xs muted">{r.department_name||'No department'}</div></td>}<td>{r.leave_type}</td><td>{new Date(r.start_date).toLocaleDateString()} – {new Date(r.end_date).toLocaleDateString()}</td><td>
  <div className="max-w-[280px] whitespace-normal break-all overflow-hidden">
    {r.reason}
  </div>
</td><td><span className="badge">{r.status}</span></td>{canApprove && (
  <td>
    {r.status === 'PENDING' &&
    !(user?.role === 'ADMIN' && r.employee_id === user?.employeeId) ? (
      <div className="flex gap-2">
        <button
          className="btn btn-accent !px-3 !py-1.5"
          onClick={() => decide(r.id, 'APPROVED')}
        >
          Approve
        </button>

        <button
          className="btn !px-3 !py-1.5"
          onClick={() => decide(r.id, 'REJECTED')}
        >
          Reject
        </button>
      </div>
    ) : r.status === 'PENDING' ? (
      'Super Admin required'
    ) : r.reviewed_by_name ? (
      <div>
        <div className="font-medium">
          {r.status === 'APPROVED' ? 'Approved by' : 'Rejected by'}
        </div>

        <div className="text-sm">
          {r.reviewed_by_name}
        </div>

        {r.reviewed_by_role && (
          <div className="text-xs muted">
            {r.reviewed_by_role.replace(/_/g, ' ')}
          </div>
        )}
      </div>
    ) : (
      '—'
    )}
  </td>
)}

{isSuper&&<td><div className="flex gap-2"><button className="btn !px-3 !py-1.5" onClick={()=>{setEditing(r);setShow(true)}}>Edit</button><button className="btn !px-3 !py-1.5 text-red-600" onClick={()=>remove(r.id)}>Delete</button></div></td>}</tr>)}</tbody></table></div>:!pageErr&&<Empty/>}
  {show&&<Modal title={editing?'Edit Leave Request':'Apply for Leave'} onClose={()=>{setShow(false);setEditing(null)}}><form onSubmit={save} className="space-y-4"><select className="input" name="type" defaultValue={editing?.leave_type||'CASUAL'}><option>CASUAL</option><option>SICK</option><option>EARNED</option><option>UNPAID</option><option>OTHER</option></select><div className="grid gap-4 sm:grid-cols-2"><div><label className="label">From Date</label><input className="input mt-1" type="date" name="startDate" defaultValue={editing?.start_date?.slice?.(0,10)||''} required/></div><div><label className="label">To Date</label><input className="input mt-1" type="date" name="endDate" defaultValue={editing?.end_date?.slice?.(0,10)||''} required/></div></div><textarea className="input min-h-28" name="reason" placeholder="Reason for leave" defaultValue={editing?.reason||''} required/>{err&&<div className="text-red-600">{err}</div>}<button className="btn btn-primary">{editing?'Save Changes':'Submit Request'}</button></form></Modal>}
  {decision&&<Modal title={decision.status==='APPROVED'?'Approve Leave Request':'Reject Leave Request'} onClose={()=>{setDecision(null);setComment('')}}><div className="space-y-4"><div><label className="label">Comment <span className="muted">(optional)</span></label><textarea className="input mt-1 min-h-28" placeholder={decision.status==='APPROVED'?'Add a comment for this approval...':'Add a reason for rejecting this leave...'} value={comment} onChange={e=>setComment(e.target.value)}/></div><div className="flex justify-end gap-3"><button type="button" className="btn" onClick={()=>{setDecision(null);setComment('')}}>Cancel</button><button type="button" className="btn btn-accent" onClick={submitDecision}>{decision.status==='APPROVED'?'Approve Leave':'Reject Leave'}</button></div></div></Modal>}
  </>;
}
