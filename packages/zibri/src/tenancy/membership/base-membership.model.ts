import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';
import { AnyEnum } from '../../types/any-enum.type';
import { Newable } from '../../types/newable.type';

/**
 * Common properties shared by all memberships: a user belonging to a tenant.
 */
export type BaseMembership<Role extends string> = BaseEntity & {
    /**
     * The id of the tenant the user belongs to.
     */
    tenantId: string,
    /**
     * The id of the user.
     */
    userId: string,
    /**
     * The roles the user holds in the tenant, which `@Auth.hasRole` checks.
     */
    roles: Role[],
    /**
     * When the membership was deactivated. A deactivated membership counts as none: the user cannot
     * act in the tenant until it is reactivated, and keeps their roles there for then. Undefined or
     * null for an active membership.
     */
    deactivatedAt?: Date | null
};

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a base membership entity class with the specified roles.
 * @param roleValue - The enum that is used for defining the roles a user holds in a tenant.
 */
export function BaseMembershipEntity<Role extends string>(
    roleValue: AnyEnum<Role>
): Newable<BaseMembership<Role>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp extends BaseEntity implements BaseMembership<Role> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'uuid' })
        tenantId!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'uuid' })
        userId!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'string', enum: roleValue } })
        roles!: Role[];
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.date({ required: false })
        deactivatedAt?: Date | null;
    }

    return Temp;
}