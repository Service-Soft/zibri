import { Transaction } from '../../data-source/transaction/transaction.model.ts';

/**
 * Interface for an authenticator that keeps the tokens of a provider for its identities, so the
 * provider's apis can be called for the user an identity is linked to.
 *
 * An application reaches what it adds through `AuthServiceInterface`.
 */
export interface ProviderAccessAuthenticatorInterface {
    /**
     * Resolves an access token for calling the provider's apis for a user, with an identity of theirs.
     * Asks the provider for a new one when the kept one has expired or is about to. Throws a
     * NotFoundError when the user has no identity of that id, and a ProviderAccessError when there is
     * no access token with the scopes.
     */
    resolveAccessToken: (userId: string, identityId: string, scopes: string[]) => Promise<string>,
    /**
     * Stops keeping the tokens of an identity of a user, and hands them back to the provider. An
     * identity that does not sign in is unlinked. Throws a NotFoundError when the user has no identity
     * of that id.
     */
    revokeAccess: (userId: string, identityId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Stops an identity of a user from signing in as them, and keeps the tokens of its apis. An identity
     * without api access is unlinked. Throws a NotFoundError when the user has no identity of that id.
     */
    revokeSignIn: (userId: string, identityId: string, transaction: Transaction | undefined) => Promise<void>
}

/**
 * Checks whether or not the given value keeps the tokens of a provider for its identities.
 * @param value - The value to check.
 * @returns True if it has every key ProviderAccessAuthenticatorInterface has.
 */
export function isProviderAccessAuthenticator<T extends object>(value: T): value is T & ProviderAccessAuthenticatorInterface {
    return 'resolveAccessToken' in value && 'revokeAccess' in value && 'revokeSignIn' in value;
}