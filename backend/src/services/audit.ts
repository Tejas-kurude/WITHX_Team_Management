import { query } from '../config/db.js';
export async function audit(userId:number|undefined, action:string, entity:string, entityId?:number|string|null, details:any={}){
  await query('INSERT INTO activity_logs(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',[userId||null,action,entity,entityId?.toString()||null,details]);
}
