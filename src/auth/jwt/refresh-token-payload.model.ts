import { BaseUser } from '../models';

export type RefreshTokenPayload<Role extends string, T extends BaseUser<Role>> = {
    /**
     * The id of the user that this refresh token belongs to.
     */
    userId: T['id']
};