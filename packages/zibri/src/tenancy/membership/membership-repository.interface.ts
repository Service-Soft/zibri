import { BaseMembership } from './base-membership.model';
import { Transaction } from '../../data-source/transaction/transaction.model';

/**
 * Marks the repository memberships are read from and written to. `BaseMembershipRepository()` sets
 * it.
 */
export const MEMBERSHIP_REPOSITORY: unique symbol = Symbol('zibri.membership-repository');

// methods rather than properties holding functions, for the reason UserRepositoryInterface gives
/* eslint-disable typescript/method-signature-style */
/**
 * Interface for a membership repository, the one place the memberships of an application are read
 * from and written to.
 */
export interface MembershipRepositoryInterface<RoleType extends string, MembershipType extends BaseMembership<RoleType>> {
    /**
     * Marks the repository as the one memberships are read from and written to.
     */
    readonly [MEMBERSHIP_REPOSITORY]: true,
    /**
     * Finds the membership of a user in a tenant, deactivated or not. Called while that tenant is
     * active.
     */
    findMembership(userId: string, tenantId: string): Promise<MembershipType | undefined>,
    /**
     * Finds the memberships of a user in every tenant, deactivated or not. A repository reading them
     * from a data source reaches across tenants, eg. With `acrossTenants`.
     */
    findMemberships(userId: string): Promise<MembershipType[]>,
    /**
     * Answers the membership of a user in the active tenant, deactivated or not, and creates one
     * without roles when they have none.
     */
    resolveMembership(userId: string, transaction: Transaction | undefined): Promise<MembershipType>,
    /**
     * Sets when the membership of a user in the active tenant was deactivated, or null to reactivate
     * it.
     */
    updateDeactivatedAt(userId: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void>,
    /**
     * Deletes the membership of a user in the active tenant, if they have one.
     */
    deleteMembership(userId: string, transaction: Transaction | undefined): Promise<void>,
    /**
     * Stores the roles of the membership of a user in the active tenant.
     */
    updateRoles(userId: string, roles: string[], transaction: Transaction | undefined): Promise<void>,
    /**
     * Deletes every membership of the given users, in every tenant. Called in the transaction that
     * deletes the users.
     */
    deleteMemberships(userIds: string[], transaction: Transaction): Promise<void>
}
/* eslint-enable typescript/method-signature-style */

/**
 * Checks whether or not the given value is a membership repository.
 * @param value - The value to check.
 * @returns True if the value carries the mark of MembershipRepositoryInterface, false otherwise.
 */
export function isMembershipRepository(value: unknown): value is MembershipRepositoryInterface<string, BaseMembership<string>> {
    return value != undefined && typeof value === 'object' && MEMBERSHIP_REPOSITORY in value;
}