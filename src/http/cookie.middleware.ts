import { createHmac, timingSafeEqual } from 'node:crypto';

import { RequestHandler } from 'express';

import { ObjectUtilities } from '../utilities/object.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
function parseCookieHeader(header: string): Record<string, string> {
    return Object.fromEntries(
        header.split('; ')
            .flatMap(pair => {
                const idx: number = pair.indexOf('=');
                if (idx < 0) {
                    return [];
                }
                return [
                    [
                        decodeURIComponent(pair.slice(0, idx).trim()),
                        decodeURIComponent(pair.slice(idx + 1))
                    ]
                ];
            })
    );
}

// eslint-disable-next-line jsdoc/require-jsdoc
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
    // eslint-disable-next-line jsdoc/require-jsdoc
    (req as typeof req & { secret?: string }).secret = secret;

    req.cookies = {};
    req.signedCookies = {};

    for (const [key, value] of ObjectUtilities.entries(raw)) {
        if (secret && value.startsWith('s:')) {
            // eslint-disable-next-line typescript/no-unsafe-member-access
            req.signedCookies[key] = unsignCookie(value.slice(2), secret);
        }
        else {
            // eslint-disable-next-line typescript/no-unsafe-member-access
            req.cookies[key] = value;
        }
    }

    next();
};