import { Response } from 'express';
export const ok = (res: Response, data: unknown, status = 200) => res.status(status).json(data);
export const fail = (res: Response, message: string, status = 400, extra: Record<string, unknown> = {}) => res.status(status).json({ message, ...extra });
