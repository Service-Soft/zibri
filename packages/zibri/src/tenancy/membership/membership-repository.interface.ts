import { BaseMembership } from './base-membership.model.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';

/**
 * Interface for a membership repository, the one place the memberships of an application are read
 * from and written to.
 */
export interface MembershipRepositoryInterface<RoleType extends string, MembershipType extends BaseMembership<RoleType>> {
    /**
     * Finds the membership of a user in a tenant, deactivated or not. Called while that tenant is
     * active.
     */
    findMembership: (userId: string, tenantId: string) => Promise<MembershipType | undefined>,
    /**
     * Finds the memberships of a user in every tenant, deactivated or not. A repository reading them
     * from a data source reaches across tenants, eg. With `acrossTenants`.
     */
    findMemberships: (userId: string) => Promise<MembershipType[]>,
    /**
     * Answers the membership of a user in the active tenant, deactivated or not, and creates one
     * without roles when they have none.
     */
    resolveMembership: (userId: string, transaction: Transaction | undefined) => Promise<MembershipType>,
    /**
     * Sets when the membership of a user in the active tenant was deactivated, or null to reactivate
     * it.
     */
    updateDeactivatedAt: (userId: string, deactivatedAt: Date | null, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Deletes the membership of a user in the active tenant, if they have one.
     */
    deleteMembership: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Deletes every membership of the given users, in every tenant. Called in the transaction that
     * deletes the users.
     */
    deleteMemberships: (userIds: string[], transaction: Transaction) => Promise<void>
}

/**
 * Checks whether or not the given value is a membership repository.
 * @param value - The value to check.
 * @returns True if the value has all the keys of MembershipRepositoryInterface, false otherwise.
 */
export function isMembershipRepository(value: unknown): value is MembershipRepositoryInterface<string, BaseMembership<string>> {
    const keys: (keyof MembershipRepositoryInterface<string, BaseMembership<string>>)[] = [
        'findMembership',
        'findMemberships',
        'resolveMembership',
        'updateDeactivatedAt',
        'deleteMembership',
        'deleteMemberships'
    ];
    if (value == undefined || typeof value !== 'object') {
        return false;
    }
    return keys.every(key => key in value);
}