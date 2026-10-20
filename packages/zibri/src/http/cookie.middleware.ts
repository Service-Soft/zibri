import { createHmac, timingSafeEqual } from 'node:crypto';

import { RequestHandler } from 'express';

import { ObjectUtilities } from '../utilities/object.utilities.ts';

/**
 * Percent decoding that gives up quietly.
 *
 * A cookie is whatever the client chose to send, and encoding it correctly is not something the
 * client can be made to do: `Cookie: a=%` is enough to make decodeURIComponent throw. Throwing from
 * here puts a URIError through the global error handler on a request that has not authenticated
 * anything, so the raw value is handed back instead - which is also what cookie-parser does.
 * @param value - The raw name or value, as it appeared in the header.
 * @returns The decoded value, or the input unchanged if it is not valid percent encoding.
 */
function tryDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}

/**
 * Parses a Cookie header into name/value pairs.
 *
 * Duplicates keep the **first** occurrence. A name can legitimately appear twice - one cookie set on
 * the host and one on a parent domain - and the more specific one comes first. Keeping the last
 * would let anything that can write a cookie for the parent domain shadow the session cookie of the
 * host it is a sibling of.
 *
 * A Map rather than an object built by assignment, so that a cookie literally named `__proto__`
 * cannot reach Object.prototype.
 * @param header - The raw Cookie header.
 * @returns The parsed cookies.
 */
function parseCookieHeader(header: string): Record<string, string> {
    const cookies: Map<string, string> = new Map();

    for (const pair of header.split(';')) {
        const idx: number = pair.indexOf('=');
        if (idx < 0) {
            continue;
        }
        const key: string = tryDecode(pair.slice(0, idx).trim());
        if (cookies.has(key)) {
            continue;
        }
        cookies.set(key, tryDecode(pair.slice(idx + 1).trim()));
    }

    return Object.fromEntries(cookies);
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function unsignCookie(value: string, secret: string): string | false {
    // cookie-signature format: <value>.<base64-hmac-without-padding>
    const tentativeValue: string = value.slice(0, value.lastIndexOf('.'));
    const expected: string = 's:' + tentativeValue + '.' + createHmac('sha256', secret)
        .update(tentativeValue)
        .digest('base64')
        .replace(/=+$/, '');

    const expectedBuf: Buffer = Buffer.from(expected);
    const inputBuf: Buffer = Buffer.from('s:' + value);

    if (expectedBuf.length !== inputBuf.length) {
        return false;
    }
    return timingSafeEqual(expectedBuf, inputBuf) ? tentativeValue : false;
}

/**
 * Middleware for handling cookies.
 * @param secret - A secret to sign cookies with.
 */
export const cookieMiddleware: (secret: string | undefined) => RequestHandler = (secret?: string): RequestHandler => (req, _, next) => {
    const header: string | undefined = req.headers.cookie;
    const raw: Record<string, string> = header ? parseCookieHeader(header) : {};

    // Express's own res.cookie()/res.clearCookie() only sign/verify with { signed: true } when req.secret is set —
    // normally done by the cookie-parser package, which this middleware replaces, so it must set it too.
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    (req as typeof req & { secret?: string }).secret = secret;

    const cookies: Map<string, string> = new Map();
    const signedCookies: Map<string, string | false> = new Map();

    for (const [key, value] of ObjectUtilities.entries(raw)) {
        if (secret && value.startsWith('s:')) {
            signedCookies.set(key, unsignCookie(value.slice(2), secret));
        }
        else {
            cookies.set(key, value);
        }
    }

    // built through fromEntries rather than assigned key by key: `req.cookies['__proto__'] = value`
    // reaches the prototype setter, which silently drops the cookie today and would be pollution the
    // moment anything but a string went in
    req.cookies = Object.fromEntries(cookies);
    req.signedCookies = Object.fromEntries(signedCookies);

    next();
};