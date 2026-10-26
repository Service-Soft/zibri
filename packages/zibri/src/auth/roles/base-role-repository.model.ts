import { BaseRole } from './base-role.model';
import { RoleRepositoryInterface } from './role-repository.interface';
import { ChangeSetRepository } from '../../data-source/change-sets/change-set-repository';
import { type ChangeSetEntity } from '../../data-source/change-sets/models/change-set-entity.model';
import { type SoftDeleteEntity } from '../../data-source/change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../data-source/change-sets/soft-delete-repository';
import { Repository } from '../../data-source/repository/repository';
import { ROLE_REPOSITORY } from '../../data-source/repository/repository-kind.model';
import { Newable } from '../../types/newable.type';

/**
 * A role repository class built over the repository a data source builds for its entity.
 */
export type RoleRepositoryClass<T extends BaseRole, R extends Repository<T>> = new (
    entityClass: Newable<T>,
    repo: R
) => R & RoleRepositoryInterface;

/**
 * Defines the base of a role repository: the repository of the role entity, which every role is read
 * from and written to. Extend the class it returns and declare it with `@RepositoryFor(Role)`.
 */
export function BaseRoleRepository<T extends BaseRole>(): RoleRepositoryClass<T, Repository<T>>;
/**
 * Defines the base of a role repository over `SoftDeleteRepository`, for a role entity that soft
 * deletes.
 * @param base - `SoftDeleteRepository`, which the class extends.
 */
export function BaseRoleRepository<T extends BaseRole & SoftDeleteEntity>(
    base: typeof SoftDeleteRepository
): RoleRepositoryClass<T, SoftDeleteRepository<T>>;
/**
 * Defines the base of a role repository over `ChangeSetRepository`, for a role entity that records
 * change sets.
 * @param base - `ChangeSetRepository`, which the class extends.
 */
export function BaseRoleRepository<T extends BaseRole & ChangeSetEntity>(
    base: typeof ChangeSetRepository
): RoleRepositoryClass<T, ChangeSetRepository<T>>;
export function BaseRoleRepository<T extends BaseRole>(
    base: typeof Repository = Repository
): Newable<Repository<T> & RoleRepositoryInterface> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    class RoleRepository extends base<T> implements RoleRepositoryInterface {
        // a getter for the reason BaseUserRepository gives
        // eslint-disable-next-line jsdoc/require-jsdoc, typescript/class-literal-property-style
        get [ROLE_REPOSITORY](): true {
            return true;
        }
    }

    return RoleRepository;
}