import { UserRepositoryInterface } from './user-repository.interface';
import { FindByIdOptions } from '../../data-source/models/options/find-by-id-options.model';
import { BaseUser } from '../models/base-user.model';

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
    // eslint-disable-next-line typescript/no-explicit-any
    readonly userRepositories: UserRepositoryInterface<string, BaseUser<string>, any>[],
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
     * Resolves the credentials for the provided user.
     */
    resolveCredentialsFor: <Role extends string, T extends BaseUser<Role>, CredentialsType>(user: T) => Promise<CredentialsType>
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
        'resolveCredentialsFor',
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