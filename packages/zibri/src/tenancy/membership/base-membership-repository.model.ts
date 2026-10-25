import { BaseMembership } from './base-membership.model';
import { MEMBERSHIP_REPOSITORY, MembershipRepositoryInterface } from './membership-repository.interface';
import { ChangeSetRepository } from '../../change-sets/change-set-repository';
import { type ChangeSetEntity } from '../../change-sets/models/change-set-entity.model';
import { type SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';

/**
 * A membership repository class built over the repository a data source builds for its entity.
 */
export type MembershipRepositoryClass<T extends BaseMembership<string>, R extends Repository<T>> = new (
    entityClass: Newable<T>,
    repo: R
) => R & MembershipRepositoryInterface<string, T>;

/**
 * Defines the base of a membership repository: a repository of the membership entity that finds,
 * creates and deletes the membership of a user in a tenant and stores its deactivation and roles.
 * Extend the class it returns and declare it with `@RepositoryFor(Membership)`.
 */
export function BaseMembershipRepository<T extends BaseMembership<string>>(): MembershipRepositoryClass<T, Repository<T>>;
/**
 * Defines the base of a membership repository over `SoftDeleteRepository`, for a membership entity
 * that soft deletes.
 * @param base - `SoftDeleteRepository`, which the class extends.
 */
export function BaseMembershipRepository<T extends BaseMembership<string> & SoftDeleteEntity>(
    base: typeof SoftDeleteRepository
): MembershipRepositoryClass<T, SoftDeleteRepository<T>>;
/**
 * Defines the base of a membership repository over `ChangeSetRepository`, for a membership entity
 * that records change sets.
 * @param base - `ChangeSetRepository`, which the class extends.
 */
export function BaseMembershipRepository<T extends BaseMembership<string> & ChangeSetEntity>(
    base: typeof ChangeSetRepository
): MembershipRepositoryClass<T, ChangeSetRepository<T>>;
export function BaseMembershipRepository<T extends BaseMembership<string>>(
    base: typeof Repository = Repository
): Newable<Repository<T> & MembershipRepositoryInterface<string, T>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class MembershipRepository extends base<T> implements MembershipRepositoryInterface<string, T> {
        // a getter for the reason BaseUserRepository gives
        // eslint-disable-next-line jsdoc/require-jsdoc, typescript/class-literal-property-style
        get [MEMBERSHIP_REPOSITORY](): true {
            return true;
        }

        // the filters and the data are cast because typescript does not resolve a mapped type over an
        // entity that is still a type parameter, though every membership entity has these columns

        // eslint-disable-next-line jsdoc/require-jsdoc
        async findMembership(userId: string): Promise<T | undefined> {
            return await this.findOne({ where: { userId } as Where<T>, required: false });
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        async findMemberships(userId: string): Promise<T[]> {
            return await this.findAll({ where: { userId } as Where<T>, acrossTenants: true });
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        async resolveMembership(userId: string, transaction: Transaction | undefined): Promise<T> {
            const roles: string[] = [];
            return await this.findOne({ where: { userId } as Where<T>, transaction, required: false })
                ?? await this.create({ userId, roles } as DeepPartial<T>, { transaction });
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        async updateDeactivatedAt(userId: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
            await this.updateAll({ userId } as Where<T>, { deactivatedAt } as DeepPartial<T>, { transaction });
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        async deleteMembership(userId: string, transaction: Transaction | undefined): Promise<void> {
            await this.deleteAll({ userId } as Where<T>, { transaction });
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        async updateRoles(userId: string, roles: string[], transaction: Transaction | undefined): Promise<void> {
            await this.updateAll({ userId } as Where<T>, { roles } as DeepPartial<T>, { transaction });
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        async deleteMemberships(userIds: string[], transaction: Transaction): Promise<void> {
            await this.deleteAll({ userId: { oneOf: userIds } } as Where<T>, { transaction, acrossTenants: true });
        }
    }

    return MembershipRepository;
}
