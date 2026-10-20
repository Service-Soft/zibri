import { Request, RequestHandler } from 'express';

import { CorsOptions } from './cors.middleware.ts';
import { HttpMethod } from './http-method.enum.ts';
import { KnownHeader } from './known-header.enum.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { ForbiddenError } from '../error-handling/errors/forbidden.error.ts';
import { $ts } from '../localization/translate.function.ts';
import { AuditAction, AuditOutcome, AuditReason } from '../logging/audit-event.model.ts';

/**
 * The methods that change nothing, and are therefore never refused.
 */
const SAFE_METHODS: string[] = [HttpMethod.GET, HttpMethod.HEAD, HttpMethod.OPTIONS];

/**
 * What `Sec-Fetch-Site` says for a request a page on this api's own origin made, or one the user
 * started themselves by typing an address or following a bookmark.
 */
const OWN_FETCH_SITES: string[] = ['same-origin', 'none'];

/**
 * Builds the middleware that refuses a request changing something when a browser sent it from
 * another origin with cookies attached.
 *
 * A browser attaches the cookies it holds for this api to requests another page causes, so such a
 * request acts with the user's authority whichever route it reaches. An origin `cors` lets send
 * credentials is let through. Requests without cookies, and requests that name no origin, such as
 * those from servers and command line tools, are let through as well. So is a request from an origin
 * the route it reaches accepts with `@AcceptCrossSitePosts`.
 * @param cors - The cors options, whose `origins` and `credentials` say which other origins may
 * send cookies.
 * @returns The middleware.
 */
export function crossOriginCookieMiddleware(cors: CorsOptions): RequestHandler {
    return async (req, res, next) => {
        if (SAFE_METHODS.includes(req.method) || req.headers[KnownHeader.COOKIE] == undefined) {
            next();
            return;
        }
        if (!isFromOtherOrigin(req) || isAllowedToSendCredentials(req, cors)) {
            next();
            return;
        }
        let accepted: string[];
        try {
            // asked last and only here, so a route accepting other origins costs nothing on every
            // other request
            accepted = await inject(ZIBRI_DI_TOKENS.ROUTER).resolveAcceptedCrossSiteOrigins(req, res);
        }
        catch (error) {
            next(error);
            return;
        }
        const origin: string | undefined = req.headers[KnownHeader.ORIGIN];
        const isAccepted: boolean = origin != undefined && accepted.includes(origin);
        // recorded either way: a request with cookies from another origin that was let through is
        // one an audit should be able to find
        inject(ZIBRI_DI_TOKENS.LOGGER).audit({
            action: AuditAction.AUTHORIZATION,
            outcome: isAccepted ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
            reason: AuditReason.CROSS_ORIGIN
        });
        next(isAccepted ? undefined : new ForbiddenError($ts`A request from another origin may not carry cookies for this api.`));
    };
}

/**
 * Whether a browser sent the request from a page on another origin.
 *
 * Fetch metadata first, which every current browser sends and which a page cannot forge. Where it is
 * missing, the origin header, compared against the origin the request was addressed to.
 * @param req - The request.
 * @returns Whether it came from another origin.
 */
function isFromOtherOrigin(req: Request): boolean {
    const fetchSite: string | undefined = req.headers[KnownHeader.SEC_FETCH_SITE];
    if (fetchSite != undefined) {
        // `same-site` included: a sibling subdomain is a different origin and can be a different
        // party - user content, a forgotten marketing page - and lax cookies reach this api from it
        return !OWN_FETCH_SITES.includes(fetchSite);
    }
    const origin: string | undefined = req.headers[KnownHeader.ORIGIN];
    // no origin at all is not a page: browsers send one on every request that changes something
    return origin != undefined && origin !== `${req.protocol}://${req.get(KnownHeader.HOST)}`;
}

/**
 * Whether cors lets the request's origin send credentials.
 * @param req - The request.
 * @param cors - The cors options.
 * @returns Whether the origin is listed and credentials are allowed.
 */
function isAllowedToSendCredentials(req: Request, cors: CorsOptions): boolean {
    // `'*'` never qualifies: it cannot be combined with credentials, so under it no other origin was
    // ever allowed to send cookies
    return cors.credentials === true
        && cors.origins !== '*'
        && cors.origins.some(o => o === req.headers[KnownHeader.ORIGIN]);
}