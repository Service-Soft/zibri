/**
 * Marks the repository roles are read from and written to. `BaseRoleRepository()` sets it.
 */
export const ROLE_REPOSITORY: unique symbol = Symbol('zibri.role-repository');

/**
 * Interface for a role repository, the one place the roles of an application are read from and
 * written to.
 */
export interface RoleRepositoryInterface {
    /**
     * Marks the repository as the one roles are read from and written to.
     */
    readonly [ROLE_REPOSITORY]: true
}

/**
 * Checks whether or not the given value is a role repository.
 * @param value - The value to check.
 * @returns True if the value carries the mark of RoleRepositoryInterface, false otherwise.
 */
export function isRoleRepository(value: unknown): value is RoleRepositoryInterface {
    return value != undefined && typeof value === 'object' && ROLE_REPOSITORY in value;
}
