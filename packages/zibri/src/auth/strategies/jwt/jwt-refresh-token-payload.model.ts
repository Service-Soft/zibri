import { BaseUser } from '../../models/base-user.model';

/**
 * The payload of the jwt refresh token.
 */
export type JwtRefreshTokenPayload<Role extends string, T extends BaseUser<Role>> = {
    /**
     * The id of the user that this refresh token belongs to.
     */
    userId: T['id']
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
    return 'userId' in payload && typeof payload.userId === 'string';
}