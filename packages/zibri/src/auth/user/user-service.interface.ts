import { UserRepositoryInterface } from './user-repository.interface.ts';
import { FindByIdOptions } from '../../data-source/models/options/find-by-id-options.model.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * Options for looking a user up.
 *
 * The repository's own requirement flag, and only that one: which data source a user comes from is
 * the user repository's business, so nothing else here would mean anything.
 */
export type FindUserOptions<Required extends boolean = true> = Pick<
    FindByIdOptions<BaseUser<string>, Required>,
    'required'
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
     * Whether the rows of an entity are users, because a user repository reads them.
     *
     * Asked by every repository deleting rows, so that the memberships of a deleted user go with them.
     */
    isUserEntity: (entityClass: Newable<BaseEntity>) => boolean
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
        'isUserEntity',
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