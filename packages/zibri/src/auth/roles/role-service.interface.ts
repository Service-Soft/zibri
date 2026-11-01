import { BaseRole } from './base-role.model';
import { type Permission } from './permission.type';
import { type PlatformPermission } from './platform-permission.type';
import { RoleCreateData } from './role-create-data.model';
import { RoleIdentity } from './role-identity.model';
import { RoleUpdateData } from './role-update-data.model';
import { WrittenRole } from './written-role.model';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { type CurrentUser } from '../decorators/current-user.decorator';

/**
 * Interface for the service keeping the roles of an application: the permissions it declares in code,
 * and the roles, which are rows of the one role repository, such as one extending `BaseRoleRepository()`. A role is one every
 * tenant shares, or a tenant role of one tenant's own.
 *
 * Checks read the roles from memory: those every tenant shares from the start, those of a tenant's
 * own from the first check in that tenant, for as many tenants as fit. A change made on one instance
 * applies there at once, and on every other instance within a few seconds, through
 * `CacheInvalidation`.
 */
export interface RoleServiceInterface {
    /**
     * Whether a value is a tenant permission the application declares.
     */
    isPermission: (value: string) => value is Permission,
    /**
     * Whether a value is a platform permission the application declares.
     */
    isPlatformPermission: (value: string) => value is PlatformPermission,
    /**
     * Resolves the permissions the provided tenant roles carry in a tenant: those of the roles every
     * tenant shares and of the tenant's own. A platform role, or one that does not exist there,
     * carries none.
     * @returns The permissions, each once.
     */
    resolvePermissionsOf: (roles: string[], tenantId: string) => Promise<Permission[]>,
    /**
     * Resolves the permissions the provided platform roles carry. A tenant role, or one that does not
     * exist, carries none.
     * @returns The permissions, each once.
     */
    resolvePlatformPermissionsOf: (roles: string[]) => PlatformPermission[],
    /**
     * Refuses roles a membership in a tenant cannot hold. Called for every write of the roles of a
     * membership, with the transaction of the write, which a role it created exists in.
     * @throws A BadRequestError when a role does not exist in the tenant, or is a platform role.
     */
    validateRoles: (roles: string[], tenantId: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Refuses roles a user cannot hold. Called for every write of the roles of a user, with the
     * transaction of the write, which a role it created exists in.
     * @throws A BadRequestError when a role does not exist, or is a tenant role.
     */
    validatePlatformRoles: (roles: string[], transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Refuses role rows that cannot be written: a level that is none, or a permission that is not
     * declared at the role's level. Called for every write of a role.
     * @throws A BadRequestError naming what is wrong.
     */
    validateRoleRows: (rows: object[]) => void,
    /**
     * Refuses roles as a write leaves them: a platform role of a tenant, a tenant's own role named
     * like a role every tenant shares, or such a role named like one a tenant has. Called for every
     * write creating a role, or changing its name, level or tenant.
     * @throws A BadRequestError naming the first role refused.
     */
    validateWrittenRoles: (roles: WrittenRole[], transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Refuses deleting, renaming or moving roles somebody holds: a role every tenant shares held
     * anywhere, a tenant's own role held in that tenant. Called for every such write.
     * @throws A BadRequestError naming the first role still held.
     */
    validateRolesNotHeld: (roles: RoleIdentity[]) => Promise<void>,
    /**
     * Reads the roles again, and tells the other instances to, once a write to them is committed.
     * @param tenantIds - The tenants whose own roles were written, null for the roles every tenant
     * shares.
     */
    handleRolesChanged: (tenantIds: (string | null)[]) => Promise<void>,
    /**
     * Finds every role the active tenant sees, ordered by name: those every tenant shares, and the
     * tenant's own. Outside every tenant, those every tenant shares.
     */
    findRoles: <T extends BaseRole>(transaction?: RepositoryTransaction) => Promise<T[]>,
    /**
     * Finds a role the active tenant sees by its name, the way `findRoles` does.
     */
    findRole: <T extends BaseRole>(name: string, transaction?: RepositoryTransaction) => Promise<T | undefined>,
    /**
     * Creates a role. One every tenant shares needs `auth.create_role` for a tenant role or
     * `auth.create_platform_role` for a platform role as a platform permission. One of a tenant's
     * own, created in a request acting in that tenant, needs `auth.create_tenant_role` as a tenant
     * permission there. Each `.with_any_permission` or, for a role carrying only permissions the
     * caller holds at its level, `.with_own_permissions`.
     * @throws A ForbiddenError when the caller may not, or names another tenant than the one the
     * request acts in, a BadRequestError when the role cannot exist.
     */
    createRole: <T extends BaseRole>(caller: CurrentUser, data: RoleCreateData<T>, transaction: RepositoryTransaction | undefined) => Promise<T>,
    /**
     * Changes a role, but not its name, level or tenant. The caller needs `auth.update_role`,
     * `auth.update_platform_role` or `auth.update_tenant_role`, checked as for creating it, against
     * the role as it is and as it becomes.
     * @throws A ForbiddenError when the caller may not, a NotFoundError when there is no such role.
     */
    updateRole: <T extends BaseRole>(
        caller: CurrentUser,
        name: string,
        data: RoleUpdateData<T>,
        transaction: RepositoryTransaction | undefined
    ) => Promise<T>,
    /**
     * Deletes a role nobody holds. The caller needs `auth.delete_role`, `auth.delete_platform_role`
     * or `auth.delete_tenant_role`, checked as for creating it.
     * @throws A ForbiddenError when the caller may not, a NotFoundError when there is no such role, a
     * BadRequestError while somebody holds it.
     */
    deleteRole: (caller: CurrentUser, name: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Gives a user a role: a platform role to the user, a tenant role to their membership in the
     * tenant the request acts in. The caller needs `auth.assign_platform_role` as a platform
     * permission, or `auth.assign_role` as a tenant permission in that tenant, `.with_any_permission`
     * or, for a role carrying only permissions they hold at its level, `.with_own_permissions`.
     * @throws A ForbiddenError when the caller may not, a NotFoundError when there is no such role,
     * user or membership, a BadRequestError for a tenant role while no tenant is active.
     */
    assignRole: (caller: CurrentUser, userId: string, role: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Takes a role from a user, the way `assignRole` gives it. The caller needs
     * `auth.unassign_platform_role` or `auth.unassign_role`, checked the same way.
     * @throws Like `assignRole`.
     */
    unassignRole: (caller: CurrentUser, userId: string, role: string, transaction: RepositoryTransaction | undefined) => Promise<void>
}