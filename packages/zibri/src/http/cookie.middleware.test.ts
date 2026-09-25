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

    it('keeps the first of two cookies sent under the same name', () => {
        // a name can appear twice because one cookie was set on the host and one on a parent
        // domain, and the more specific one comes first. Keeping the last would let anything able
        // to write a cookie for the parent domain shadow the session cookie of a sibling host.
        const req: Request = invoke('secret', 'sessionId=host; sessionId=parent-domain');
        expect(req.cookies).toEqual({ sessionId: 'host' });
    });

    it('keeps the first even when the shadowing cookie is a validly signed one', () => {
        // the attacker's own session is legitimately signed, so the hmac check cannot be what
        // rejects it - only the ordering can.
        const victim: string = sign('victim-session', 'my-secret');
        const attacker: string = sign('attacker-session', 'my-secret');
        const req: Request = invoke('my-secret', `session=s:${victim}; session=s:${attacker}`);
        expect(req.signedCookies).toEqual({ session: 'victim-session' });
    });

    it('hands back the raw value rather than throwing on invalid percent encoding', () => {
        // `Cookie: broken=%` used to raise a URIError out of an unauthenticated request, which the
        // global error handler logs to the database - a write per request, from anyone.
        const req: Request = invoke('secret', 'broken=%; %=also-broken; fine=value');
        expect(req.cookies).toEqual({ broken: '%', '%': 'also-broken', fine: 'value' });
    });

    it('parses pairs separated without a space', () => {
        const req: Request = invoke('secret', 'foo=bar;baz=qux');
        expect(req.cookies).toEqual({ foo: 'bar', baz: 'qux' });
    });

    it('does not let a cookie named __proto__ reach the prototype', () => {
        const req: Request = invoke('secret', '__proto__=polluted; foo=bar');
        // not expressible as an object literal: `{ __proto__: x }` is prototype syntax rather than
        // a property, which is the whole reason the name is dangerous to assign.
        expect(Object.getOwnPropertyDescriptor(req.cookies, '__proto__')?.value).toBe('polluted');
        expect(Object.getPrototypeOf(req.cookies)).toBe(Object.prototype);
        expect(req.cookies).toHaveProperty('foo', 'bar');
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