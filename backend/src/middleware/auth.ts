import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

type JwtUser = { userId:number; employeeId:number|null; role:string; email:string };
declare global { namespace Express { interface Request { user?: JwtUser } } }

export function authenticate(req:Request,res:Response,next:NextFunction){
  const header=req.headers.authorization;
  if(!header?.startsWith('Bearer ')) return res.status(401).json({message:'Authentication required'});
  try{
    req.user=jwt.verify(header.slice(7), process.env.JWT_SECRET || 'dev-secret') as JwtUser;
    next();
  }catch{ return res.status(401).json({message:'Invalid or expired token'}); }
}

export const allowRoles=(...roles:string[]) => (req:Request,res:Response,next:NextFunction)=>{
  if(!req.user || !roles.includes(req.user.role)) return res.status(403).json({message:'You do not have permission for this action'});
  next();
};
