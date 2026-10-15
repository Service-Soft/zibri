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
     * Brings what follows the memberships of users in line with what is stored: which tenants'
     * websocket broadcasts their connections receive.
     *
     * Called once a write to memberships is committed, with each user and tenant it wrote.
     */
    handleMembershipsChanged: (memberships: ChangedMembership[]) => Promise<void>
}