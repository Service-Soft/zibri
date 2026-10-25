import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';

/**
 * Marks an entity whose rows are the users of the application, as a static member of its class.
 * `BaseUserEntity()` sets it.
 */
export const USER_ENTITY: unique symbol = Symbol('zibri.user-entity');

/**
 * Common properties shared by all users.
 */
export type BaseUser<Role extends string> = BaseEntity & {
    /**
     * The email of the user.
     */
    email: string,
    /**
     * The platform roles of the user, which \@Auth.hasPlatformRole checks. Each is one
     * `ZIBRI_DI_TOKENS.ROLES_AND_PERMISSIONS` declares at the platform level.
     */
    roles: Role[],
    /**
     * When the user was deactivated. A deactivated user cannot log in, and no request acts as them,
     * until they are reactivated. Undefined or null for an active user.
     */
    deactivatedAt?: Date | null
};

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a base user entity class, whose roles are typed as the given ones.
 *
 * Which roles a user may hold is what `ZIBRI_DI_TOKENS.ROLES_AND_PERMISSIONS` declares at the
 * platform level: writing any other is refused.
 */
export function BaseUserEntity<Role extends string = string>(): Newable<BaseUser<Role>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp extends BaseEntity implements BaseUser<Role> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        static readonly [USER_ENTITY]: true = true;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'email', unique: true })
        email!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'string' } })
        roles!: Role[];
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.date({ required: false })
        deactivatedAt?: Date | null;
    }

    return Temp;
}

/**
 * Checks whether or not the given value is a base user.
 * @param value - The value to check.
 * @returns True if the value has "id", "email" and "roles" keys, false otherwise.
 */
export function isBaseUser(value: unknown): value is BaseUser<string> {
    return (
        value != undefined
        && typeof value === 'object'
        && 'id' in value
        && 'email' in value
        && 'roles' in value
    );
}