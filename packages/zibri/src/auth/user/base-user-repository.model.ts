import { USER_REPOSITORY, UserRepositoryInterface } from './user-repository.interface';
import { ChangeSetRepository } from '../../change-sets/change-set-repository';
import { type ChangeSetEntity } from '../../change-sets/models/change-set-entity.model';
import { type SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * A user repository class built over the repository a data source builds for its entity.
 */
export type UserRepositoryClass<T extends BaseUser<string>, R> = new (
    entityClass: Newable<T>,
    repo: R
) => R & UserRepositoryInterface<string, T>;

/**
 * Defines the base of a user repository: a repository of the user entity that finds users by email
 * and stores their deactivation and roles. Extend the class it returns and declare it with
 * `@RepositoryFor(User)`. `CreateData` is what a user is created with.
 */
export function BaseUserRepository<
    T extends BaseUser<string>,
    CreateData extends DeepPartial<T> = DeepPartial<T>
>(): UserRepositoryClass<T, Repository<T, CreateData>>;
/**
 * Defines the base of a user repository over `SoftDeleteRepository`, for a user entity that soft
 * deletes.
 * @param base - `SoftDeleteRepository`, which the class extends.
 */
export function BaseUserRepository<T extends BaseUser<string> & SoftDeleteEntity>(
    base: typeof SoftDeleteRepository
): UserRepositoryClass<T, SoftDeleteRepository<T>>;
/**
 * Defines the base of a user repository over `ChangeSetRepository`, for a user entity that records
 * change sets.
 * @param base - `ChangeSetRepository`, which the class extends.
 */
export function BaseUserRepository<T extends BaseUser<string> & ChangeSetEntity>(
    base: typeof ChangeSetRepository
): UserRepositoryClass<T, ChangeSetRepository<T>>;
export function BaseUserRepository<T extends BaseUser<string>>(
    base: typeof Repository = Repository
): Newable<Repository<T> & UserRepositoryInterface<string, T>> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class UserRepository extends base<T> implements UserRepositoryInterface<string, T> {
        // a getter rather than a field, so that the mark is on the prototype, where the data source
        // reads it off the class before any instance of it exists
        // eslint-disable-next-line jsdoc/require-jsdoc, typescript/class-literal-property-style
        get [USER_REPOSITORY](): true {
            return true;
        }

        // the filters and the data are cast because typescript does not resolve a mapped type over an
        // entity that is still a type parameter, though every user entity has these columns

        // eslint-disable-next-line jsdoc/require-jsdoc
        async findByEmail(email: string): Promise<T> {
            return await this.findOne({ where: { email } as Where<T> });
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        async updateDeactivatedAt(id: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
            await this.updateById(id, { deactivatedAt } as DeepPartial<T>, { transaction });
        }

        // eslint-disable-next-line jsdoc/require-jsdoc
        async updateRoles(id: string, roles: string[], transaction: Transaction | undefined): Promise<void> {
            await this.updateById(id, { roles } as DeepPartial<T>, { transaction });
        }
    }

    return UserRepository;
}
