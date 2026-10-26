import type { ChangeSetEntity } from '../../data-source/change-sets/models/change-set-entity.model';
import type { SoftDeleteEntity } from '../../data-source/change-sets/models/soft-delete-entity.model';
import { MEMBERSHIP_ENTITY } from '../../data-source/repository/repository-kind.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';
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
     * The roles the user holds in the tenant, which `@Auth.hasRole` checks. Each is one
     * `ZIBRI_DI_TOKENS.ROLES_AND_PERMISSIONS` declares at the tenant level.
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
 * Defines a base membership entity class, whose roles are typed as the given ones.
 *
 * Which roles a membership may hold is what `ZIBRI_DI_TOKENS.ROLES_AND_PERMISSIONS` declares at the
 * tenant level: writing any other is refused.
 */
export function BaseMembershipEntity<Role extends string = string>(): Newable<BaseMembership<Role>>;
// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a base membership entity class that soft deletes, whose roles are typed as the given
 * ones. It declares no unique, so a soft deleted membership holds no value another could want.
 * @param base - `SoftDeleteEntity`, which the class extends.
 */
export function BaseMembershipEntity<Role extends string = string>(base: typeof SoftDeleteEntity): Newable<SoftDeleteEntity & BaseMembership<Role>>;
// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines a base membership entity class that records its change sets, whose roles are typed as the
 * given ones.
 * @param base - `ChangeSetEntity`, which the class extends.
 */
export function BaseMembershipEntity<Role extends string = string>(base: typeof ChangeSetEntity): Newable<ChangeSetEntity & BaseMembership<Role>>;
export function BaseMembershipEntity<Role extends string = string>(base: typeof BaseEntity = BaseEntity): Newable<BaseMembership<Role>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp extends base implements BaseMembership<Role> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        static readonly [MEMBERSHIP_ENTITY]: true = true;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'uuid' })
        tenantId!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'uuid' })
        userId!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'string' } })
        roles!: Role[];
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.date({ required: false })
        deactivatedAt?: Date | null;
    }

    return Temp;
}