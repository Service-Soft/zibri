import { LoginAuthStrategyInterface } from './login-auth-strategy.interface';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { BaseUser } from '../models/base-user.model';
import { ListedLogin } from '../models/listed-login.model';

/**
 * Interface for an auth strategy that lists the logins of a user and ends them one at a time, for a
 * user to see where they are logged in and end a login on a device they lost.
 */
export interface LoginListingAuthStrategyInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    AuthDataType,
    RefreshLoginDataType,
    LogoutData
> extends LoginAuthStrategyInterface<RoleType, UserType, AuthDataType, RefreshLoginDataType, LogoutData> {
    /**
     * Finds the logins of a user that are live: started and not ended or expired.
     */
    findLogins: (userId: string, transaction: Transaction | undefined) => Promise<ListedLogin[]>,
    /**
     * Ends one login of a user.
     * @returns Whether the user had that login.
     */
    endLogin: (userId: string, loginId: string, transaction: Transaction | undefined) => Promise<boolean>,
    /**
     * Resolves the login the request carries, by the id `findLogins` lists it with.
     */
    resolveLoginId: (context: HttpRequestContext | WebsocketRequestContext) => Promise<string | undefined>
}

/**
 * Whether a strategy lists the logins of a user.
 * @param strategy - The strategy.
 * @returns True when it has every member of `LoginListingAuthStrategyInterface`.
 */
export function isLoginListingAuthStrategy(
    strategy: LoginAuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown>
): strategy is LoginListingAuthStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown> {
    return 'findLogins' in strategy && 'endLogin' in strategy && 'resolveLoginId' in strategy;
}