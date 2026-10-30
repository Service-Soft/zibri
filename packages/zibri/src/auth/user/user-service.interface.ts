import { UserRepositoryInterface } from './user-repository.interface';
import { FindByIdOptions } from '../../data-source/models/options/find-by-id-options.model';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Options for looking a user up: whether the user has to exist, and the transaction to read in, as
 * every user repository is asked in it.
 */
export type FindUserOptions<Required extends boolean = true> = Pick<
    FindByIdOptions<BaseUser<string>, Required>,
    'required' | 'transaction'
>;

/**
 * Interface for a user service.
 */
export interface UserServiceInterface {
    /**
     * All user repositories that have been registered.
     */
    readonly userRepositories: UserRepositoryInterface<string, BaseUser<string>>[],
    /**
     * Finds a user by the given id.
     */
    findById: <Role extends string, T extends BaseUser<Role>, B extends boolean = true>(
        id: T['id'],
        options?: FindUserOptions<B>
    ) => Promise<B extends false ? T | undefined : T>,
    /**
     * Finds a user by the given email.
     */
    findByEmail: <Role extends string, T extends BaseUser<Role>, B extends boolean = true>(
        email: string,
        options?: FindUserOptions<B>
    ) => Promise<B extends false ? T | undefined : T>,
    /**
     * Stores when a user was deactivated, or null to reactivate them, in the user repository that
     * holds them.
     * @throws A NotFoundError when no user repository holds the user.
     */
    updateDeactivatedAt: (id: string, deactivatedAt: Date | null, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Stores the roles a user holds of their own, in the user repository that holds them.
     * @throws A NotFoundError when no user repository holds the user.
     */
    updateRoles: (id: string, roles: string[], transaction: Transaction | undefined) => Promise<void>,
    /**
     * Stores the email of a user and when it was verified, or null while it is not, in the user
     * repository that holds them.
     * @throws A NotFoundError when no user repository holds the user.
     */
    updateEmail: (id: string, email: string, emailVerifiedAt: Date | null, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Whether the rows of an entity are users, because a user repository reads them.
     *
     * Asked by every repository deleting rows, so that the memberships of a deleted user go with them.
     */
    isUserEntity: (entityClass: Newable<BaseEntity>) => boolean,
    /**
     * Gets the entities the users of every user repository built on the data layer are stored as, so
     * that what follows users can observe their writes. Known once the application has initialized.
     */
    getUserEntityClasses: () => Newable<BaseUser<string>>[],
    /**
     * Finds the roles stored users hold other than the given ones, eg. To refuse starting an
     * application whose users hold a role that does not exist.
     *
     * Reads the users of every user repository built on the data layer.
     */
    findUnknownRoles: (known: string[]) => Promise<string[]>,
    /**
     * Whether a stored user holds a role, eg. To refuse deleting it.
     *
     * Reads the users of every user repository built on the data layer.
     */
    isRoleHeld: (role: string) => Promise<boolean>
}

/**
 * Checks whether or not the given value is a user service.
 * @param value - The value to check.
 * @returns True if the value has all the keys of UserServiceInterface, false otherwise.
 */
export function isUserService(value: unknown): value is UserServiceInterface {
    const keys: (keyof UserServiceInterface)[] = [
        'findByEmail',
        'findById',
        'updateDeactivatedAt',
        'updateRoles',
        'updateEmail',
        'isUserEntity',
        'getUserEntityClasses',
        'findUnknownRoles',
        'isRoleHeld',
        'userRepositories'
    ];

    if (value == undefined || typeof value !== 'object') {
        return false;
    }

    for (const key of keys) {
        if (!(key in value)) {
            return false;
        }
    }

    return true;
}