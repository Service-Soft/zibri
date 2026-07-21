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
    roles: T['roles']
};