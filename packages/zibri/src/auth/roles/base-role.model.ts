import type { PermissionWildcard } from './permission-wildcard.type';
import type { Permission } from './permission.type';
import type { PlatformPermission } from './platform-permission.type';
import type { RoleLevel } from './role-level.type';
import { ROLE_ENTITY } from '../../data-source/repository/repository-kind.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * The levels a role can be held at, as the enum of its column.
 */
const ROLE_LEVELS: Readonly<Record<string, RoleLevel>> = { tenant: 'tenant', platform: 'platform' };

/**
 * Common properties shared by all roles: a name users and memberships hold, and the permissions it
 * carries.
 */
export type BaseRole = BaseEntity & {
    /**
     * What identifies the role: what users and memberships hold. Unique across both levels, and a
     * role of a tenant's own is named apart from every role all tenants share.
     */
    name: string,
    /**
     * The tenant whose own role it is, seen and held in that tenant alone. Null for a role every
     * tenant shares, which every platform role is.
     */
    tenantId?: string | null,
    /**
     * Where the role is held: a tenant role through a membership, a platform role by the user.
     */
    level: RoleLevel,
    /**
     * The permissions the role carries: tenant permissions for a tenant role, platform permissions for
     * a platform role, each by name or by a wildcard. A role standing above another lists the other's
     * permissions as well.
     */
    permissions: (Permission | PlatformPermission | PermissionWildcard)[]
};

/**
 * The base role entity, for the role entity of the application to extend with what it keeps about a
 * role besides, such as a description. Declared with `@Entity()`, since a role belongs to a tenant
 * or to none.
 */
export class BaseRoleEntity extends BaseEntity implements BaseRole {
    // eslint-disable-next-line jsdoc/require-jsdoc
    static readonly [ROLE_ENTITY]: true = true;
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ unique: true })
    name!: string;
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ enum: ROLE_LEVELS })
    level!: RoleLevel;
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.array({ items: { type: 'string' } })
    permissions!: (Permission | PlatformPermission | PermissionWildcard)[];
}