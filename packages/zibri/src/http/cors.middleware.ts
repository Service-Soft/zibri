import { Request, RequestHandler } from 'express';

import { Header } from './header.type';
import { HttpMethod } from './http-method.enum';
import { KnownHeader } from './known-header.enum';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * An origin a browser page can be served from.
 *
 * Scheme and host, and a port when it is not the default one - which is exactly what a browser puts
 * in the origin header and therefore the only thing that can ever match. A bare host or a trailing
 * slash never matches anything, so both are kept out of the type rather than left to be debugged.
 */
export type CorsOrigin = `https://${string}` | `http://${string}`;

/**
 * Which browser origins may call this api, and what they may send.
 *
 * Only relevant to browsers: cors is enforced by them and nothing else, so it decides what a page on
 * another origin may do with a user's credentials rather than who can reach the api at all.
 */
export type CorsOptions = {
    /**
     * The origins a browser page may call this api from.
     *
     * `'*'` allows every one, which is right for an api that is public or is only ever called with a
     * token the calling page had to be handed deliberately. It is wrong as soon as the browser
     * attaches credentials by itself - see `credentials`.
     */
    origins: '*' | CorsOrigin[],
    /**
     * The methods a browser may use. Defaults to every method the framework can route.
     */
    methods?: HttpMethod[],
    /**
     * Request headers a browser may send **on top of** the ones the framework needs itself.
     *
     * Additional rather than replacing, because the framework's own headers - the csrf token, the two
     * factor code, the trace context - have to be allowed for its own features to work from a
     * browser at all. A list that replaced them would quietly disable them.
     */
    additionalAllowedHeaders?: Header[],
    /**
     * Whether a browser may send cookies and credentials it holds for this api.
     *
     * Required for cookie based auth from another origin, and refused together with `origins: '*'`:
     * a wildcard plus credentials means "any page anywhere may act as this user", which browsers
     * reject outright rather than honor.
     */
    credentials?: boolean
};

/**
 * The default, and what it is chosen for.
 *
 * Every origin, no credentials. Nothing a browser does on its own reaches an api under this - a page
 * on another origin may send a request, but no cookies are attached to it, so acting as a signed in
 * user still needs a token that page was given deliberately. Locking it down is one option away, and
 * has to be, because the right value depends on where the api is deployed rather than on the
 * framework.
 */
export const defaultCorsOptions: CorsOptions = { origins: '*' };

/**
 * Builds the middleware that answers preflights and marks responses as cross origin readable.
 * @param options - Which origins may call, and what they may send.
 * @returns The middleware.
 * @throws When credentials are allowed for every origin, which no browser would honor anyway.
 */
export function corsMiddleware(options: CorsOptions): RequestHandler {
    if (options.credentials === true && options.origins === '*') {
        throw new InternalError([
            'cors was configured with credentials and origins "*", which browsers refuse:',
            'a wildcard origin cannot carry credentials, so this would not loosen anything - it would',
            'stop cookie based auth working from a browser entirely.',
            'List the origins that may send credentials instead.'
        ]);
    }

    const allowedMethods: string = (options.methods ?? Object.values(HttpMethod)).join(',');
    let allowedHeaders: string | undefined = undefined;
    let exposedHeaders: string | undefined = undefined;

    return (req, res, next) => {
        // resolved on the first request rather than here: the headers the framework needs are di
        // tokens so that they can be renamed, and nothing is registered yet while the application is
        // still being constructed. Every request is long after that.
        allowedHeaders ??= [
            KnownHeader.CONTENT_TYPE,
            KnownHeader.AUTHORIZATION,
            KnownHeader.DPOP,
            KnownHeader.X_VERSION,
            inject(ZIBRI_DI_TOKENS.CSRF_TOKEN_HEADER),
            inject(ZIBRI_DI_TOKENS.OTP_HEADER),
            inject(ZIBRI_DI_TOKENS.PASSKEY_HEADER),
            inject(ZIBRI_DI_TOKENS.EMAIL_CODE_HEADER),
            inject(ZIBRI_DI_TOKENS.SMS_CODE_HEADER),
            inject(ZIBRI_DI_TOKENS.RECOVERY_CODE_HEADER),
            inject(ZIBRI_DI_TOKENS.API_KEY_HEADER),
            KnownHeader.TRACEPARENT,
            KnownHeader.TRACESTATE,
            ...options.additionalAllowedHeaders ?? []
        ].join(', ');
        // a browser hides every response header a page did not ask to see, so headers the framework
        // answers *with* have to be listed as well. The csrf token is the one that matters: it is
        // reissued on the response whose session rotated, and a page that cannot read it goes on
        // sending the token that was just retired. A DPoP nonce likewise, which a page signs its next
        // proof with.
        exposedHeaders ??= [
            inject(ZIBRI_DI_TOKENS.CSRF_TOKEN_HEADER),
            KnownHeader.DPOP_NONCE,
            KnownHeader.TRACERESPONSE
        ].join(', ');

        if (options.origins !== '*') {
            // the answer depends on who asked, so a shared cache must not hand one origin's response
            // to another
            res.vary(KnownHeader.ORIGIN);
        }

        const origin: CorsOrigin | '*' | undefined = allowedOrigin(req, options);
        if (origin != undefined) {
            res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_ORIGIN, origin);
            res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_METHODS, allowedMethods);
            res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_HEADERS, allowedHeaders);
            res.setHeader(KnownHeader.ACCESS_CONTROL_EXPOSE_HEADERS, exposedHeaders);
            if (options.credentials === true) {
                res.setHeader(KnownHeader.ACCESS_CONTROL_ALLOW_CREDENTIALS, 'true');
            }
        }

        // only an actual preflight is answered here, and a browser preflight always carries this
        // header. Anything else calling OPTIONS is asking what the endpoint supports, which express
        // answers with an allow header listing the methods that exist. Answering all of them here
        // replaced that with a blank 200 - for every path in the app, including ones that do not
        // exist at all.
        const isPreflight: boolean = req.method === HttpMethod.OPTIONS
            && req.headers[KnownHeader.ACCESS_CONTROL_REQUEST_METHOD] != undefined;
        if (isPreflight) {
            res.sendStatus(200);
            return;
        }
        next();
    };
}

/**
 * The origin to answer with, or undefined when this one may not read the response.
 *
 * An origin that is not allowed is not an error: the request still runs, and the browser is simply
 * never told it may hand the result to the page. Refusing it here would break every non browser
 * caller instead, none of which send an origin at all.
 * @param req - The request.
 * @param options - The configured origins.
 * @returns What to put in the allow origin header, if anything.
 */
function allowedOrigin(req: Request, options: CorsOptions): CorsOrigin | '*' | undefined {
    if (options.origins === '*') {
        return '*';
    }
    const origin: string | undefined = req.headers[KnownHeader.ORIGIN];
    return options.origins.find(o => o === origin);
}