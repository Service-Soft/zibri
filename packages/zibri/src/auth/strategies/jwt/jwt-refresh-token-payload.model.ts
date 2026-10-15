import { BaseUser } from '../../models/base-user.model';

/**
 * The payload of the jwt refresh token.
 */
export type JwtRefreshTokenPayload<Role extends string, T extends BaseUser<Role>> = {
    /**
     * The id of the user that this refresh token belongs to.
     */
    userId: T['id'],
    // named and typed like the access token's claim it is copied into - see there for why it is not
    // a camel cased Date
    /**
     * When the user logged in, in seconds since the epoch. Every refresh token of one login carries
     * the same value.
     */
    auth_time: number
};

/**
 * Whether a verified token's payload is a refresh token payload.
 * @param payload - The verified payload.
 * @returns Whether it can be read as a refresh token payload.
 */
export function isJwtRefreshTokenPayload<Role extends string>(
    payload: unknown
): payload is JwtRefreshTokenPayload<Role, BaseUser<Role>> {
    if (typeof payload !== 'object' || payload == undefined) {
        return false;
    }
    return 'userId' in payload && typeof payload.userId === 'string'
        && 'auth_time' in payload && typeof payload.auth_time === 'number';
}