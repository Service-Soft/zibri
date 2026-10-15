import { AuthorizationToken } from './authorization-token.model';
import { isJwtConfirmation } from './jwt/jwt-confirmation.model';
import { JwtUtilities } from './jwt/jwt.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';

/**
 * Reads the access token of a request's authorization header.
 */
export abstract class AuthorizationHeaderUtilities {
    /**
     * Finds the access token a request sends, with the `Bearer` or the `DPoP` scheme.
     * @param context - The context of the request.
     * @returns The token and its scheme, or undefined when the request sends none.
     */
    static findToken(context: HttpRequestContext | WebsocketRequestContext): AuthorizationToken | undefined {
        const authorization: string | string[] | undefined = context.request.headers?.authorization;
        if (typeof authorization !== 'string') {
            return undefined;
        }
        const parts: string[] = authorization.split(' ');
        const [scheme, value] = parts;
        if (parts.length !== 2 || value == undefined) {
            return undefined;
        }
        return scheme === 'Bearer' || scheme === 'DPoP' ? { scheme, value } : undefined;
    }

    /**
     * Finds the access token a request sends when it is shaped like a jwt the application issued, and
     * says whether it is one a client was issued. Read without verifying it: this decides which
     * strategy reads the token, and that strategy verifies it.
     * @param context - The context of the request.
     * @param issuer - The issuer of the application's own tokens.
     * @returns The kind of jwt, or undefined when the token is none, or names another issuer.
     */
    static findJwtKind(context: HttpRequestContext | WebsocketRequestContext, issuer: string): 'client' | 'login' | undefined {
        const token: AuthorizationToken | undefined = AuthorizationHeaderUtilities.findToken(context);
        if (token?.value.split('.').length !== 3) {
            return undefined;
        }
        const payload: unknown = JwtUtilities.findUnverifiedPayload(token.value);
        if (typeof payload !== 'object' || payload == undefined) {
            return 'login';
        }
        // a token of an identity provider, which ProviderTokenAuthStrategy reads. One naming no issuer
        // stays here, where it does not verify
        if ('iss' in payload && typeof payload.iss === 'string' && payload.iss !== issuer) {
            return undefined;
        }
        // shaped like a client's token, not proven one: a token of the wrong shape verifies as neither
        return 'client_id' in payload ? 'client' : 'login';
    }

    /**
     * Finds the issuer the access token a request sends names, when it is shaped like a jwt. Read
     * without verifying it, to decide who verifies it.
     * @param context - The context of the request.
     * @returns Its `iss`, or undefined when the token is no jwt or names none.
     */
    static findJwtIssuer(context: HttpRequestContext | WebsocketRequestContext): string | undefined {
        const token: AuthorizationToken | undefined = AuthorizationHeaderUtilities.findToken(context);
        const payload: unknown = token == undefined ? undefined : JwtUtilities.findUnverifiedPayload(token.value);
        return typeof payload === 'object' && payload != undefined && 'iss' in payload && typeof payload.iss === 'string'
            ? payload.iss
            : undefined;
    }

    /**
     * Whether a request sends an access token bound to a client certificate, read without verifying it.
     * @param context - The context of the request.
     * @returns True when the token names a certificate it is bound to.
     */
    static hasCertificateBoundToken(context: HttpRequestContext | WebsocketRequestContext): boolean {
        const token: AuthorizationToken | undefined = AuthorizationHeaderUtilities.findToken(context);
        const payload: unknown = token == undefined ? undefined : JwtUtilities.findUnverifiedPayload(token.value);
        return typeof payload === 'object'
            && payload != undefined
            && 'cnf' in payload
            && isJwtConfirmation(payload.cnf)
            && payload.cnf['x5t#S256'] != undefined;
    }
}