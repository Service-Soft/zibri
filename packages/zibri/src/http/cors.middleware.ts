import { RequestHandler } from 'express';

import { KnownHeader } from './known-header.enum';

/**
 * Middleware for handling CORS.
 * @param req - The request.
 * @param res - The response.
 * @param next - The next handler.
 */
export const corsMiddleWare: RequestHandler = (req, res, next) => {
    res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_ORIGIN, '*');
    res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_METHODS, 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_HEADERS, 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
};