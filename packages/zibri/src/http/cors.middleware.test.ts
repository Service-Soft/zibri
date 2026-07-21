import { describe, expect, it, jest } from '@jest/globals';
import { Request, Response } from 'express';

import { corsMiddleWare } from './cors.middleware';
import { KnownHeader } from './known-header.enum';

function createRes(): Response {
    return {
        setHeader: jest.fn(),
        sendStatus: jest.fn()
    } as unknown as Response;
}

describe('corsMiddleWare', () => {
    it('sets the expected cors headers and calls next for a non-OPTIONS request', () => {
        const req: Request = { method: 'GET' } as unknown as Request;
        const res: Response = createRes();
        const next: jest.Mock = jest.fn();

        corsMiddleWare(req, res, next as unknown as () => void);

        expect(res.setHeader).toHaveBeenCalledWith(KnownHeader.ACCESS_CONTROL_ALLOW_ORIGIN, '*');
        expect(res.setHeader).toHaveBeenCalledWith(KnownHeader.ACCESS_CONTROL_ALLOW_METHODS, 'GET,POST,PUT,DELETE,OPTIONS');
        expect(res.setHeader).toHaveBeenCalledWith(KnownHeader.ACCESS_CONTROL_ALLOW_HEADERS, 'Content-Type, Authorization');
        expect(res.sendStatus).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('short-circuits an OPTIONS preflight request with a 200 and does not call next', () => {
        const req: Request = { method: 'OPTIONS' } as unknown as Request;
        const res: Response = createRes();
        const next: jest.Mock = jest.fn();

        corsMiddleWare(req, res, next as unknown as () => void);

        expect(res.sendStatus).toHaveBeenCalledWith(200);
        expect(next).not.toHaveBeenCalled();
    });
});