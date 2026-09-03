import axios from 'axios';
export const api=axios.create({baseURL:import.meta.env.VITE_API_URL||'http://localhost:5000/api'});
api.interceptors.request.use((c)=>{const t=localStorage.getItem('withx_token');if(t)c.headers.Authorization=`Bearer ${t}`;return c});
api.interceptors.response.use(r=>r,e=>{if(e.response?.status===401){localStorage.removeItem('withx_token');localStorage.removeItem('withx_user');if(location.pathname!='/login')location.href='/login'}return Promise.reject(e)});
export const messageOf=(e:any)=>e?.response?.data?.message||e?.message||'Something went wrong';
