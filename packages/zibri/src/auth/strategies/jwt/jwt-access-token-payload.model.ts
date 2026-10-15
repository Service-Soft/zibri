import { isJwtConfirmation, JwtConfirmation } from './jwt-confirmation.model';
import { BaseUser } from '../../models/base-user.model';

/**
 * The payload of a jwt access token.
 */
export type JwtAccessTokenPayload<Role extends string, T extends BaseUser<Role>> = {
    /**
     * The id of the user.
     */
    id: T['id'],
    /**
     * The email of the user.
     */
    email: T['email'],
    /**
     * The roles of the user.
     */
    roles: T['roles'],
    // snake case and seconds rather than a camel cased Date on purpose: this is the OpenID Connect
    // claim of that name, so anything reading the token by the published keys finds it where the
    // standard puts it. A payload is json, which has no dates - `exp` and `iat` are seconds too
    /**
     * When the user logged in, in seconds since the epoch, as the OpenID Connect `auth_time` claim.
     * Refreshing the login keeps it.
     */
    auth_time: number,
    /**
     * The login the token belongs to, which every token of it carries, refreshes included. Named as
     * the OpenID Connect session id claim.
     */
    sid: string,
    /**
     * The DPoP key the token is bound to, when the login was started with a proof.
     */
    cnf?: JwtConfirmation
};

/**
 * Whether a verified token's payload is an access token payload.
 *
 * Verification proves a token came from this application; it does not prove what is inside it, and
 * the framework signs a second, differently shaped payload with a second secret. Reading `id` and
 * `roles` off whatever came back assumed the two could never be confused.
 *
 * Role *values* are not checked, only that they are strings. Nothing here knows which roles the
 * application defines, and a role that is not one of them satisfies no check anyway.
 * @param payload - The verified payload.
 * @returns Whether it can be read as an access token payload.
 */
export function isJwtAccessTokenPayload<Role extends string>(
    payload: unknown
): payload is JwtAccessTokenPayload<Role, BaseUser<Role>> {
    if (typeof payload !== 'object' || payload == undefined) {
        return false;
    }
    return 'id' in payload && typeof payload.id === 'string'
        && 'email' in payload && typeof payload.email === 'string'
        && 'roles' in payload && Array.isArray(payload.roles) && payload.roles.every(r => typeof r === 'string')
        && 'auth_time' in payload && typeof payload.auth_time === 'number'
        && 'sid' in payload && typeof payload.sid === 'string'
        && (!('cnf' in payload) || isJwtConfirmation(payload.cnf));
}