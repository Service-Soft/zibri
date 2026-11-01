import { Authenticators } from './authenticators.model';
import { ZibriApplication } from '../../application/application';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { Authentication } from '../models/authentication.model';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator: what proves who someone is.
 *
 * An authenticator checks a proof, such as a password, and answers with the user it belongs to. What
 * happens with that answer is up to an auth strategy, which starts a login for the user. Any
 * authenticator can start a login of any strategy.
 */
export interface AuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType
> {
    /**
     * The name of the authenticator.
     */
    readonly name: string,
    /**
     * Initializes the authenticator.
     */
    init?: (app: ZibriApplication) => void | Promise<void>,
    /**
     * Checks the given credentials, inside the transaction the login runs in, if any.
     *
     * Throws an http error below 500 when they do not prove who someone is, and any other error when
     * the check itself could not be made.
     */
    authenticate: (credentials: CredentialsType, transaction: RepositoryTransaction | undefined) => Promise<Authentication<UserType>>,
    /**
     * Deletes every row the authenticator keeps for the given users, such as their passwords or their
     * identities at a provider. Called in the transaction that deletes the users for good, so a user
     * is never gone while their rows stay; a soft deleted user keeps them, and gets them back with a
     * restore.
     */
    deleteUserRows?: (userIds: string[], transaction: RepositoryTransaction) => Promise<void>
}

/**
 * Checks whether or not the given value is an authenticator.
 * @param value - The value to check.
 * @returns True if all keys of the AuthenticatorInterface are present, false otherwise.
 */
export function isAuthenticator(value: unknown): value is InstanceType<Authenticators[number]> {
    if (value == undefined || typeof value !== 'object') {
        return false;
    }
    const keys: (keyof InstanceType<Authenticators[number]>)[] = ['authenticate', 'name'];
    return !keys.find(key => !(key in value));
}