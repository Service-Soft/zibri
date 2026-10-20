import { Authenticators } from './authenticators.model.ts';
import { ZibriApplication } from '../../application/application.ts';
import { Transaction } from '../../data-source/transaction/transaction.model.ts';
import { Authentication } from '../models/authentication.model.ts';
import { BaseUser } from '../models/base-user.model.ts';

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
    authenticate: (credentials: CredentialsType, transaction: Transaction | undefined) => Promise<Authentication<UserType>>
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