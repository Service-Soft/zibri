import { BaseUser } from '../../models';

/**
 * The payload of the jwt refresh token.
 */
export type JwtRefreshTokenPayload<Role extends string, T extends BaseUser<Role>> = {
    /**
     * The id of the user that this refresh token belongs to.
     */
    userId: T['id']
};