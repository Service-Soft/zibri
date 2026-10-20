import { AuthenticatorInterface, isAuthenticator } from './authenticator.interface.ts';
import { ProviderToken } from './provider-token.model.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * Interface for an authenticator whose provider's tokens a request may send as its credential, such as
 * the access token a mobile app holds from the company's identity provider.
 *
 * `ProviderTokenAuthStrategy` reads them: it hands a token to the authenticator whose `issuer` the
 * token names.
 */
export interface ProviderTokenAuthenticatorInterface<
    RoleType extends string,
    UserType extends BaseUser<RoleType>,
    CredentialsType
> extends AuthenticatorInterface<RoleType, UserType, CredentialsType> {
    /**
     * The issuer the provider's tokens name as their `iss`.
     */
    readonly issuer: string,
    /**
     * Whether the authenticator takes any of its provider's tokens.
     */
    readonly acceptsProviderTokens: boolean,
    /**
     * Verifies a token of the provider, and finds the user the identity it names is linked to.
     * Answers undefined for a token that does not verify, is not one the authenticator takes, or names
     * an identity linked to nobody.
     */
    findProviderToken: (token: string) => Promise<ProviderToken | undefined>
}

/**
 * Checks whether or not the given value is an authenticator whose provider's tokens a request may send.
 * @param value - The value to check.
 * @returns True if it is an authenticator and has every key ProviderTokenAuthenticatorInterface adds.
 */
export function isProviderTokenAuthenticator(
    value: unknown
): value is ProviderTokenAuthenticatorInterface<string, BaseUser<string>, unknown> {
    if (!isAuthenticator(value)) {
        return false;
    }
    const keys: string[] = ['issuer', 'acceptsProviderTokens', 'findProviderToken'];
    return keys.every(key => key in value);
}