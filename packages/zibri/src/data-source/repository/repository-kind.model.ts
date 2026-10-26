import { DiVariant, DiVariants } from '../../di/models/di-variant.model';

/**
 * Marks an entity whose rows are the users of the application, as a static member of its class.
 * `BaseUserEntity()` sets it.
 */
export const USER_ENTITY: unique symbol = Symbol('zibri.user-entity');

/**
 * Marks the repository users are read from and written to. `BaseUserRepository()` sets it.
 */
export const USER_REPOSITORY: unique symbol = Symbol('zibri.user-repository');

/**
 * Marks an entity whose rows are the memberships of users in a tenant, as a static member of its
 * class. `BaseMembershipEntity()` sets it.
 */
export const MEMBERSHIP_ENTITY: unique symbol = Symbol('zibri.membership-entity');

/**
 * Marks the repository memberships are read from and written to. `BaseMembershipRepository()` sets
 * it.
 */
export const MEMBERSHIP_REPOSITORY: unique symbol = Symbol('zibri.membership-repository');

/**
 * Marks an entity whose rows are the roles of the application, as a static member of its class.
 * `BaseRoleEntity` sets it.
 */
export const ROLE_ENTITY: unique symbol = Symbol('zibri.role-entity');

/**
 * Marks the repository roles are read from and written to. `BaseRoleRepository()` sets it.
 */
export const ROLE_REPOSITORY: unique symbol = Symbol('zibri.role-repository');

/**
 * What the rows of an entity are to the framework besides rows, with the marks that say so.
 */
export type RepositoryKind = {
    /**
     * What the rows are, for the messages.
     */
    name: 'user' | 'membership' | 'role',
    /**
     * The mark on the class of the entity, a static member so that it is no part of its rows.
     */
    entityMark: symbol,
    /**
     * The mark on the prototype of its repository.
     */
    repositoryMark: symbol,
    /**
     * The shipped base of such a repository, for the messages.
     */
    base: string,
    /**
     * The shipped base of such an entity, for the messages.
     */
    entityBase: string,
    /**
     * What the framework finds the repository by.
     */
    variant: DiVariant
};

// here rather than beside the bases in auth and tenancy, which set the marks: the data layer reads
// them while it registers repositories, before anything runs that could register them, and it
// imports nothing built on it (09 §Q9)
export const REPOSITORY_KINDS: RepositoryKind[] = [
    {
        name: 'user',
        entityMark: USER_ENTITY,
        repositoryMark: USER_REPOSITORY,
        base: 'BaseUserRepository',
        entityBase: 'BaseUserEntity()',
        variant: DiVariants.USER_REPO
    },
    {
        name: 'membership',
        entityMark: MEMBERSHIP_ENTITY,
        repositoryMark: MEMBERSHIP_REPOSITORY,
        base: 'BaseMembershipRepository',
        entityBase: 'BaseMembershipEntity()',
        variant: DiVariants.MEMBERSHIP_REPO
    },
    {
        name: 'role',
        entityMark: ROLE_ENTITY,
        repositoryMark: ROLE_REPOSITORY,
        base: 'BaseRoleRepository',
        entityBase: 'BaseRoleEntity',
        variant: DiVariants.ROLE_REPO
    }
];
