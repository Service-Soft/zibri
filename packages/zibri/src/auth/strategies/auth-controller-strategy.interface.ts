import { AuthStrategyInterface } from './auth-strategy.interface';
import { isLoginAuthStrategy, LoginAuthStrategyInterface } from './login-auth-strategy.interface';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an auth strategy the routes of `AuthController` log in, refresh and log out with.
 */
export interface AuthControllerStrategyInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    AuthDataType,
    RefreshLoginDataType,
    LogoutDataType
> extends LoginAuthStrategyInterface<RoleType, UserType, AuthDataType, RefreshLoginDataType, LogoutDataType> {
    /**
     * The model of what a login and a refresh answer with.
     */
    readonly authDataModel: Newable<AuthDataType>,
    /**
     * The model of the body the refresh route takes. The route adds the transaction.
     */
    readonly refreshLoginModel: Newable<Omit<RefreshLoginDataType, 'transaction'>>,
    /**
     * The model of the body the logout route takes. The route adds the transaction.
     */
    readonly logoutModel: Newable<Omit<LogoutDataType, 'transaction'>>,
    /**
     * Whether a login the strategy starts goes out with the response it is started in, as cookies do.
     * A sign-in at a provider without a code challenge logs in on the redirect back from it, which only
     * such a strategy can do. Any other strategy has the login handed over by code.
     */
    readonly logsInWithResponse: boolean,
    /**
     * Starts a transaction in the data source the strategy keeps its logins in, which a login, a refresh
     * and a logout run in.
     */
    startTransaction: () => Promise<Transaction>
}

/**
 * Checks whether or not the given auth strategy is one the routes of `AuthController` log in with.
 * @param strategy - The strategy to check.
 * @returns True if it carries logins and has every key AuthControllerStrategyInterface adds.
 */
export function isAuthControllerStrategy(
    strategy: AuthStrategyInterface<string, BaseUser<string>>
): strategy is AuthControllerStrategyInterface<string, BaseUser<string>, unknown, unknown, unknown> {
    if (!isLoginAuthStrategy(strategy)) {
        return false;
    }
    const keys: string[] = ['authDataModel', 'refreshLoginModel', 'logoutModel', 'logsInWithResponse', 'startTransaction'];
    return keys.every(key => key in strategy);
}