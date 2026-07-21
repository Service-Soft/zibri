import { createHmac } from 'node:crypto';

import { describe, expect, it, jest } from '@jest/globals';
import { Request, Response } from 'express';

import { cookieMiddleware } from './cookie.middleware';

// Mirrors the cookie-signature format used by express's res.cookie({ signed: true }),
// independent of cookie.middleware.ts's own implementation, so the test doesn't just echo the source.
function sign(value: string, secret: string): string {
    return `${value}.${createHmac('sha256', secret).update(value)
        .digest('base64')
        .replace(/=+$/, '')}`;
}

function createReq(cookieHeader: string | undefined): Request {
    return { headers: { cookie: cookieHeader } } as unknown as Request;
}

function invoke(secret: string | undefined, cookieHeader: string | undefined): Request {
    const req: Request = createReq(cookieHeader);
    const next: jest.Mock = jest.fn();
    cookieMiddleware(secret)(req, {} as Response, next as unknown as () => void);
    expect(next).toHaveBeenCalledTimes(1);
    return req;
}

describe('cookieMiddleware', () => {
    it('sets empty cookies objects when there is no cookie header', () => {
        const req: Request = invoke('secret', undefined);
        expect(req.cookies).toEqual({});
        expect(req.signedCookies).toEqual({});
    });

    it('parses a single unsigned cookie', () => {
        const req: Request = invoke('secret', 'foo=bar');
        expect(req.cookies).toEqual({ foo: 'bar' });
        expect(req.signedCookies).toEqual({});
    });

    it('parses multiple cookies', () => {
        const req: Request = invoke('secret', 'foo=bar; baz=qux');
        expect(req.cookies).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('decodes url-encoded names and values', () => {
        const req: Request = invoke('secret', `${encodeURIComponent('a b')}=${encodeURIComponent('c d')}`);
        expect(req.cookies).toEqual({ 'a b': 'c d' });
    });

    it('skips malformed pairs without an "="', () => {
        const req: Request = invoke('secret', 'foo=bar; malformed; baz=qux');
        expect(req.cookies).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('unsigns a validly signed cookie into signedCookies', () => {
        const signed: string = sign('the-value', 'my-secret');
        const req: Request = invoke('my-secret', `session=s:${signed}`);
        expect(req.signedCookies).toEqual({ session: 'the-value' });
        expect(req.cookies).toEqual({});
    });

    it('sets false for a tampered signed cookie', () => {
        const signed: string = sign('the-value', 'my-secret');
        const req: Request = invoke('my-secret', `session=s:tampered-${signed}`);
        expect(req.signedCookies).toEqual({ session: false });
    });

    it('sets false for a signed cookie verified with the wrong secret', () => {
        const signed: string = sign('the-value', 'correct-secret');
        const req: Request = invoke('wrong-secret', `session=s:${signed}`);
        expect(req.signedCookies).toEqual({ session: false });
    });

    it('treats a signed-looking cookie as a plain cookie when no secret is configured', () => {
        const signed: string = sign('the-value', 'my-secret');
        const req: Request = invoke(undefined, `session=s:${signed}`);
        expect(req.cookies).toEqual({ session: `s:${signed}` });
        expect(req.signedCookies).toEqual({});
    });
});