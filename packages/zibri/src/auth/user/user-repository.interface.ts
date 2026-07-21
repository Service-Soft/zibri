import { isUserService } from './user-service.interface';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for a User Repository.
 */
export interface UserRepositoryInterface<RoleType extends string, UserType extends BaseUser<RoleType>, CredentialsType> {
    /**
     * Finds a by the provided id.
     */
    findById: (id: UserType['id']) => Promise<UserType>,
    /**
     * Finds a user by the provided email.
     */
    findByEmail: (mail: UserType['email']) => Promise<UserType>,
    /**
     * Resolves the credentials for the given user.
     */
    resolveCredentialsFor: (user: UserType) => Promise<CredentialsType>
}

/**
 * Checks whether or not the given value is a user repository.
 * @param value - The value to check.
 * @returns True if the value has all the keys of UserRepositoryInterface, false otherwise.
 */
// eslint-disable-next-line typescript/no-explicit-any
export function isUserRepository(value: unknown): value is UserRepositoryInterface<string, BaseUser<string>, any> {
    // eslint-disable-next-line typescript/no-explicit-any
    const keys: (keyof UserRepositoryInterface<string, BaseUser<string>, any>)[] = [
        'findByEmail',
        'findById',
        'resolveCredentialsFor'
    ];

    if (value == undefined || typeof value !== 'object') {
        return false;
    }

    for (const key of keys) {
        if (!(key in value)) {
            return false;
        }
    }

    if (isUserService(value)) {
        return false;
    }

    return true;
}