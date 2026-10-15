import { AuthenticatorInterface, isAuthenticator } from './authenticator.interface';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator the login route of `AuthController` logs in with.
 */
export interface AuthControllerAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType
> extends AuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * The model of the credentials the login route takes for this authenticator.
     */
    readonly credentialsModel: Newable<CredentialsType>
}

/**
 * Checks whether or not the given value is an authenticator the login route of `AuthController` logs in with.
 * @param value - The value to check.
 * @returns True if it is an authenticator and has every key AuthControllerAuthenticatorInterface adds.
 */
export function isAuthControllerAuthenticator(
    value: unknown
): value is AuthControllerAuthenticatorInterface<string, BaseUser<string>, unknown> {
    return isAuthenticator(value) && 'credentialsModel' in value;
}