import { FindByIdOptions } from '../../data-source/models/options/find-by-id-options.model';
import { USER_REPOSITORY } from '../../data-source/repository/repository-kind.model';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { BaseUser } from '../models/base-user.model';

// methods rather than properties holding functions, so that a class extending one implementing it,
// such as one extending BaseUserRepository(), can override them: a property of the interface would
// be one of the class the mixin answers, which a method of a subclass cannot override
/* eslint-disable typescript/method-signature-style */
/**
 * Interface for a User Repository.
 */
export interface UserRepositoryInterface<RoleType extends string, UserType extends BaseUser<RoleType>> {
    /**
     * Marks the repository as the one users are read from and written to.
     */
    readonly [USER_REPOSITORY]: true,
    /**
     * Finds a user by the provided id, inside the transaction when one is given.
     */
    findById(id: UserType['id'], options?: Pick<FindByIdOptions<UserType>, 'transaction'>): Promise<UserType>,
    /**
     * Finds a user by the provided email, inside the transaction when one is given.
     */
    findByEmail(mail: UserType['email'], options?: Pick<FindByIdOptions<UserType>, 'transaction'>): Promise<UserType>,
    /**
     * Stores when a user was deactivated, or null to reactivate them.
     */
    updateDeactivatedAt(id: UserType['id'], deactivatedAt: Date | null, transaction: RepositoryTransaction | undefined): Promise<void>,
    /**
     * Stores the roles a user holds of their own.
     */
    updateRoles(id: UserType['id'], roles: string[], transaction: RepositoryTransaction | undefined): Promise<void>,
    /**
     * Stores the email of a user, and when it was verified, or null while it is not.
     */
    updateEmail(id: UserType['id'], email: string, emailVerifiedAt: Date | null, transaction: RepositoryTransaction | undefined): Promise<void>
}
/* eslint-enable typescript/method-signature-style */

/**
 * Checks whether or not the given value is a user repository.
 * @param value - The value to check.
 * @returns True if the value carries the mark of UserRepositoryInterface, false otherwise.
 */
export function isUserRepository(value: unknown): value is UserRepositoryInterface<string, BaseUser<string>> {
    return value != undefined && typeof value === 'object' && USER_REPOSITORY in value;
}