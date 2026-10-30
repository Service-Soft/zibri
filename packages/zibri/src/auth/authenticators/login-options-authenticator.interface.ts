import { AuthControllerAuthenticatorInterface, isAuthControllerAuthenticator } from './auth-controller-authenticator.interface';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator whose login answers a challenge it hands out first, such as a passkey.
 * The `login-options` route of `AuthController` hands it out.
 */
export interface LoginOptionsAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    LoginOptionsType
> extends AuthControllerAuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * The model of what the `login-options` route answers with.
     */
    readonly loginOptionsModel: Newable<LoginOptionsType>,
    /**
     * Starts a login, and answers with what the client logs in with.
     */
    resolveLoginOptions: () => Promise<LoginOptionsType>
}

/**
 * Checks whether or not the given value is an authenticator that hands out a challenge to log in with.
 * @param value - The value to check.
 * @returns True if it has every key LoginOptionsAuthenticatorInterface adds.
 */
export function isLoginOptionsAuthenticator(
    value: unknown
): value is LoginOptionsAuthenticatorInterface<string, BaseUser<string>, unknown, unknown> {
    return isAuthControllerAuthenticator(value) && 'loginOptionsModel' in value && 'resolveLoginOptions' in value;
}