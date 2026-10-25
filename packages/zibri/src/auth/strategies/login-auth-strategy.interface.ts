import { AuthStrategyInterface } from './auth-strategy.interface';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { FederatedSessionMatch } from '../authenticators/federated/federated-session-match.model';
import { Authentication } from '../models/authentication.model';
import { BaseUser } from '../models/base-user.model';
import { EndedLogin } from '../models/ended-login.model';

/**
 * Interface for an auth strategy that carries a login from one request to the next.
 *
 * Besides turning a request into a user, it starts, refreshes and ends logins. Proving who someone
 * is in the first place is the job of an authenticator, which hands the strategy the user to start a
 * login for.
 */
export interface LoginAuthStrategyInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    AuthDataType,
    RefreshLoginDataType,
    LogoutData
> extends AuthStrategyInterface<RoleType, UserType> {
    /**
     * Starts a login for a user an authenticator has just authenticated.
     *
     * The login keeps `authenticatedAt` for as long as it lasts, which is what
     * `resolveAuthenticatedAt` answers, and `federatedSession`, which `endFederatedLogins` finds it by.
     */
    startLogin: (authentication: Authentication<UserType>, transaction: Transaction | undefined) => Promise<AuthDataType>,
    /**
     * Ends the login the data names.
     * @returns The login it ended: whose it was, and the session at a provider it was started from.
     * Undefined when the data names no login to end, such as a credential already spent.
     * @throws When the login could not be ended, which leaves it live.
     */
    logout: (data: LogoutData) => Promise<EndedLogin | undefined>,
    /**
     * Refreshes the login of a user.
     */
    refreshLogin: (data: RefreshLoginDataType) => Promise<AuthDataType>,
    /**
     * Ends every login of the given user, for example once their password has been reset.
     *
     * What the strategy issued but cannot take back, such as a signed token, stays valid until it
     * expires. Nothing can be refreshed into a new login afterwards.
     */
    endLogins: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Ends the logins started from a session at a provider, once the user logged out there: every login
     * of the person at the provider, or those of one session of theirs when the match names it.
     *
     * Like `endLogins`, what the strategy cannot take back stays valid until it expires.
     */
    endFederatedLogins: (session: FederatedSessionMatch, transaction: Transaction | undefined) => Promise<void>
}

/**
 * Checks whether or not the given auth strategy carries logins.
 * @param strategy - The strategy to check.
 * @returns True if all keys of the LoginAuthStrategyInterface are present, false otherwise.
 */
export function isLoginAuthStrategy(
    strategy: AuthStrategyInterface<string, BaseUser<string>>
): strategy is LoginAuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown> {
    const keys: (keyof LoginAuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown>)[] = [
        'endFederatedLogins',
        'endLogins',
        'logout',
        'refreshLogin',
        'startLogin'
    ];
    return keys.every(key => key in strategy);
}