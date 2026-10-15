import { AuthControllerAuthenticatorInterface, isAuthControllerAuthenticator } from './auth-controller-authenticator.interface';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * Interface for an authenticator whose login answers a challenge it hands out first, such as a passkey.
 * The `sign-in-options` route of `AuthController` hands it out.
 */
export interface SignInOptionsAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType,
    SignInOptionsType
> extends AuthControllerAuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * The model of what the `sign-in-options` route answers with.
     */
    readonly signInOptionsModel: Newable<SignInOptionsType>,
    /**
     * Starts a sign-in, and answers with what the client signs in with.
     */
    resolveSignInOptions: () => Promise<SignInOptionsType>
}

/**
 * Checks whether or not the given value is an authenticator that hands out a challenge to sign in with.
 * @param value - The value to check.
 * @returns True if it has every key SignInOptionsAuthenticatorInterface adds.
 */
export function isSignInOptionsAuthenticator(
    value: unknown
): value is SignInOptionsAuthenticatorInterface<string, BaseUser<string>, unknown, unknown> {
    return isAuthControllerAuthenticator(value) && 'signInOptionsModel' in value && 'resolveSignInOptions' in value;
}