import { BaseEntity, Property } from '../../entity';
import { AnyEnum, Newable } from '../../types';

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

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a base user entity class with the specified roles.
 * @param roleValue - The enum that is used for defining the roles of the user.
 */
export function BaseUserEntity<Role extends string>(
    roleValue: AnyEnum<Role>
): Newable<BaseUser<Role>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp extends BaseEntity implements BaseUser<Role> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'email', unique: true })
        email!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'string', enum: roleValue } })
        roles!: Role[];
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