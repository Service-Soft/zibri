import { isUserService } from './user-service.interface.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * Interface for a User Repository.
 */
export interface UserRepositoryInterface<RoleType extends string, UserType extends BaseUser<RoleType>> {
    /**
     * Finds a by the provided id.
     */
    findById: (id: UserType['id']) => Promise<UserType>,
    /**
     * Finds a user by the provided email.
     */
    findByEmail: (mail: UserType['email']) => Promise<UserType>,
    /**
     * Stores when a user was deactivated, or null to reactivate them.
     */
    updateDeactivatedAt: (id: UserType['id'], deactivatedAt: Date | null, transaction: Transaction | undefined) => Promise<void>
}

/**
 * Checks whether or not the given value is a user repository.
 * @param value - The value to check.
 * @returns True if the value has all the keys of UserRepositoryInterface, false otherwise.
 */
export function isUserRepository(value: unknown): value is UserRepositoryInterface<string, BaseUser<string>> {
    const keys: (keyof UserRepositoryInterface<string, BaseUser<string>>)[] = [
        'findByEmail',
        'findById',
        'updateDeactivatedAt'
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