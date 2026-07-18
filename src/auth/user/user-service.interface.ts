import { UserRepositoryInterface } from './user-repository.interface';
import { BaseUser } from '../models/base-user.model';

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
    findById: <Role extends string, T extends BaseUser<Role>>(id: T['id']) => Promise<T>,
    /**
     * Finds a user by the given email.
     */
    findByEmail: <Role extends string, T extends BaseUser<Role>>(email: string) => Promise<T>,
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