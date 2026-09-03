import {FormEvent,useEffect,useState} from 'react';
import {api,messageOf} from '../services/api';
import {Empty,Modal,PageTitle} from '../components/UI';
import {useAuth} from '../context/AuthContext';

export default function Notifications(){
  const {user}=useAuth();const isSuper=user?.role==='SUPER_ADMIN';
  const [rows,setRows]=useState<any[]>([]),[editing,setEditing]=useState<any|null>(null),[pageErr,setPageErr]=useState(''),[err,setErr]=useState('');
  async function load(){try{setPageErr('');const r=await api.get('/notifications');setRows(r.data)}catch(e){setPageErr(messageOf(e))}}
  useEffect(()=>{void load()},[]);
  async function read(id:number){try{await api.put(`/notifications/${id}/read`);await load()}catch(e){setPageErr(messageOf(e))}}
  async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();setErr('');try{await api.put(`/notifications/${editing.id}`,Object.fromEntries(new FormData(e.currentTarget).entries()));setEditing(null);await load()}catch(e){setErr(messageOf(e))}}
  async function remove(id:number){if(!confirm('Delete this notification?'))return;try{await api.delete(`/notifications/${id}`);await load()}catch(e){alert(messageOf(e))}}
  return <><PageTitle title="Notifications" subtitle="Task, leave, report and system alerts"/>{pageErr&&<div className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{pageErr}</div>}{rows.length?<div className="space-y-3">{rows.map(n=><div key={n.id} className={`card w-full p-4 ${n.is_read?'opacity-70':''}`}><div className="flex justify-between gap-3"><button onClick={()=>read(n.id)} className="flex-1 text-left"><div className="font-extrabold">{n.title}</div>{n.employee_name&&<div className="mt-0.5 text-xs font-semibold text-orange">{n.employee_name}</div>}<p className="mt-1 text-sm muted">{n.message}</p></button><div className="flex items-start gap-2">{!n.is_read&&<span className="mt-2 h-2 w-2 rounded-full bg-orange"/>}{isSuper&&<><button className="btn !px-3 !py-1.5" onClick={()=>setEditing(n)}>Edit</button><button className="btn !px-3 !py-1.5 text-red-600" onClick={()=>remove(n.id)}>Delete</button></>}</div></div><div className="mt-2 text-xs muted">{new Date(n.created_at).toLocaleString()}</div></div>)}</div>:!pageErr&&<Empty/>}{editing&&<Modal title="Edit Notification" onClose={()=>setEditing(null)}><form className="space-y-4" onSubmit={save}><input className="input" name="title" defaultValue={editing.title} required/><textarea className="input min-h-28" name="message" defaultValue={editing.message} required/>{err&&<div className="text-red-600">{err}</div>}<button className="btn btn-primary">Save Changes</button></form></Modal>}</>;
}
