import { NextFunction } from 'express';

import { HttpRequest, HttpResponse } from '../http';

/**
 * A global error handler function.
 */
export type GlobalErrorHandler = (err: unknown, req: HttpRequest, res: HttpResponse, next: NextFunction) => void;