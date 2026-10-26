import { BaseUser } from './base-user.model';
import { ProviderAuthentication } from './provider-authentication.model';
import { FederatedSession } from '../authenticators/federated/federated-session.model';

/**
 * Who proved who they are, and when.
 *
 * What an authenticator answers and what a strategy starts a login from.
 */
export type Authentication<UserType extends BaseUser<string>> = {
    /**
     * The user that was authenticated.
     */
    user: UserType,
    /**
     * When the user proved who they are. A strategy keeps it for the whole login, refreshes included.
     */
    authenticatedAt: Date,
    /**
     * The session at a provider the user logged in through, when they did. A strategy keeps it for the
     * whole login, refreshes included, so a logout at the provider can end it.
     */
    federatedSession?: FederatedSession,
    /**
     * How the user proved who they are at the provider they logged in through, when the provider
     * says. A strategy keeps it for the whole login, refreshes included, so a route can take the
     * second factor presented there in place of one presented here.
     */
    providerAuthentication?: ProviderAuthentication
};