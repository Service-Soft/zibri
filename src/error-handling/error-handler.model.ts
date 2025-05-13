import { NextFunction, Request, Response } from 'express';

export type GlobalErrorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => void;