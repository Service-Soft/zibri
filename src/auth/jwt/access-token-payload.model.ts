import { BaseUser } from '../models';

export type AccessTokenPayload<Role extends string, T extends BaseUser<Role>> = {
    /**
     * The id of the user.
     */
    id: T['id'],
    email: T['email'],
    /**
     * The roles of the user.
     */
    roles: T['roles']
};