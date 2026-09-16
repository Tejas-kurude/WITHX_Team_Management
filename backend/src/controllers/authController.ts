import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';

export async function login(req:Request,res:Response){
  const {email,password}=req.body;
  if(!email||!password) return res.status(400).json({message:'Email and password are required'});
  const {rows}=await query<any>(`SELECT u.id,u.email,u.password_hash,u.role,u.is_active,u.employee_id,
    e.first_name,e.last_name,e.job_title,d.name department_name
    FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id
    WHERE lower(u.email)=lower($1)`,[email]);
  const user=rows[0];
  if(!user || !user.is_active || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({message:'Invalid email or password'});
  const token=jwt.sign({userId:user.id,employeeId:user.employee_id,role:user.role,email:user.email},process.env.JWT_SECRET||'dev-secret',{expiresIn:(process.env.JWT_EXPIRES_IN||'8h') as any});
  res.json({token,user:{id:user.id,email:user.email,role:user.role,employeeId:user.employee_id,name:[user.first_name,user.last_name].filter(Boolean).join(' ')||user.email,jobTitle:user.job_title,department:user.department_name}});
}

export async function me(req:Request,res:Response){
  const {rows}=await query<any>(`SELECT u.id,u.email,u.role,u.employee_id,e.first_name,e.last_name,e.job_title,d.name department_name
  FROM users u LEFT JOIN employees e ON e.id=u.employee_id LEFT JOIN departments d ON d.id=e.department_id WHERE u.id=$1`,[req.user!.userId]);
  if(!rows[0]) return res.status(404).json({message:'User not found'});
  const u=rows[0]; res.json({id:u.id,email:u.email,role:u.role,employeeId:u.employee_id,name:[u.first_name,u.last_name].filter(Boolean).join(' ')||u.email,jobTitle:u.job_title,department:u.department_name});
}
