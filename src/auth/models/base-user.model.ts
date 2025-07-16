import { BaseEntity } from '../../entity';

/**
 * Common properties shared by all users.
 */
export type BaseUser<Role extends string> = BaseEntity & {
    /**
     * The email of the user.
     */
    email: string,
    /**
     * The roles of the user.
     */
    roles: Role[]
};