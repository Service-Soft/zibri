import { BaseMembership } from './base-membership.model';
import { ChangedMembership } from './changed-membership.model';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * Interface for the service that answers which tenants a user belongs to, and with which roles.
 */
export interface MembershipServiceInterface {
    /**
     * Finds the membership of a user in a tenant. A deactivated membership is none.
     */
    findMembership: <Role extends string, T extends BaseMembership<Role>>(userId: string, tenantId: string) => Promise<T | undefined>,
    /**
     * Finds the memberships of a user in every tenant, eg. To let them pick the tenant to work in.
     * Deactivated memberships are left out.
     */
    findMemberships: <Role extends string, T extends BaseMembership<Role>>(userId: string) => Promise<T[]>,
    /**
     * Answers the membership of a user in a tenant, deactivated or not, and creates one without roles
     * when they have none.
     */
    resolveMembership: <Role extends string, T extends BaseMembership<Role>>(
        userId: string,
        tenantId: string,
        transaction: Transaction | undefined
    ) => Promise<T>,
    /**
     * Sets when the membership of a user in a tenant was deactivated, or null to reactivate it.
     */
    updateDeactivatedAt: (
        userId: string,
        tenantId: string,
        deactivatedAt: Date | null,
        transaction: Transaction | undefined
    ) => Promise<void>,
    /**
     * Deletes the membership of a user in a tenant, if they have one.
     */
    deleteMembership: (userId: string, tenantId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Stores the roles a user holds through their membership in a tenant.
     */
    updateRoles: (userId: string, tenantId: string, roles: string[], transaction: Transaction | undefined) => Promise<void>,
    /**
     * Deletes every membership of the given users, in every tenant.
     *
     * Called by the repository of a user entity whenever it deletes users, in the same transaction.
     */
    deleteMemberships: (userIds: string[], transaction: Transaction) => Promise<void>,
    /**
     * Whether the given entity is the one memberships are stored in.
     *
     * Every write to it is reported to `handleMembershipsChanged`.
     */
    isMembershipEntity: (entityClass: Newable<BaseEntity>) => boolean,
    /**
     * Finds the roles stored memberships hold other than the given ones and those of their tenant's
     * own, in every tenant, eg. To refuse starting an application whose members hold a role that does
     * not exist.
     * @param known - The roles every tenant shares.
     * @param findTenantRoles - Finds the roles of a tenant's own, asked only for the tenants of
     * memberships holding a role every tenant does not share.
     */
    findUnknownRoles: (known: string[], findTenantRoles: (tenantId: string) => Promise<string[]>) => Promise<string[]>,
    /**
     * Whether a stored membership holds a role, eg. To refuse deleting it.
     * @param role - The name of the role.
     * @param tenantId - The tenant to look in, undefined for every tenant.
     */
    isRoleHeld: (role: string, tenantId: string | undefined) => Promise<boolean>,
    /**
     * Brings what follows the memberships of users in line with what is stored: which tenants'
     * websocket broadcasts their connections receive.
     *
     * Called once a write to memberships is committed, with each user and tenant it wrote.
     */
    handleMembershipsChanged: (memberships: ChangedMembership[]) => Promise<void>
}