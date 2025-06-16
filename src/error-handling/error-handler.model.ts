import { NextFunction } from 'express';

import { HttpRequest, HttpResponse } from '../http';

export type GlobalErrorHandler = (err: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => void;