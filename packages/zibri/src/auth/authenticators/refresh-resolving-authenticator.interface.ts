import { Transaction } from '../../data-source/transaction/transaction.model';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator that has a say in every refresh of a login, whichever authenticator
 * started the login: a directory that checks the user's entry is still enabled, say.
 *
 * The login strategies of the framework ask it through `AuthServiceInterface.resolveRefreshUser`
 * before they rotate anything.
 */
export interface RefreshResolvingAuthenticatorInterface<RoleType extends string, UserType extends BaseUser<RoleType>> {
    /**
     * Answers the user a refresh continues the login of: updated, such as their roles, or as they are.
     * Throws an AccountDeactivatedError to refuse the refresh and end every login and api key of the
     * user, or any other error to refuse only this refresh.
     */
    resolveRefreshUser: (user: UserType, transaction: Transaction | undefined) => Promise<UserType>
}

/**
 * Checks whether or not the given value has a say in every refresh of a login.
 * @param value - The value to check.
 * @returns True if it has every key RefreshResolvingAuthenticatorInterface has.
 */
export function isRefreshResolvingAuthenticator<T extends object>(
    value: T
): value is T & RefreshResolvingAuthenticatorInterface<string, BaseUser<string>> {
    return 'resolveRefreshUser' in value;
}