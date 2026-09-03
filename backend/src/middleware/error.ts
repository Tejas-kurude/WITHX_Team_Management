import { NextFunction, Request, Response } from 'express';
export function errorHandler(err:any,_req:Request,res:Response,_next:NextFunction){
  console.error(err);
  if(err?.code==='23505') return res.status(409).json({message:'A record with that value already exists.'});
  res.status(500).json({message:'Internal server error'});
}
