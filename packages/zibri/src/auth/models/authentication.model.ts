import { FederatedSession } from '../authenticators/federated/federated-session.model';
import { BaseUser } from './base-user.model';
import { ProviderAuthentication } from './provider-authentication.model';

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
    providerAuthentication?: ProviderAuthentication,
    /**
     * Whether the user chooses a new password before the login starts, as an authenticator checking a
     * password says. Asked for after the second factor, when the login asks for one.
     */
    passwordChangeRequired?: boolean,
    /**
     * Whether the login is complete without the second factor `twoFactorAtLogin` asks for, as an
     * authenticator whose proof stands on its own says. False unless set.
     */
    completesWithoutSecondFactor?: boolean,
    /**
     * The names of the two factor methods that do not count as the second factor of the login, such as
     * codes by email after a login by a link sent by email, which proves the same mailbox. None unless set.
     */
    excludedTwoFactorMethods?: string[],
    /**
     * Whether the login counts as a recent login, where a route accepts one in place of a second
     * factor. A strategy keeps it for the whole login, refreshes included. True unless set to false.
     */
    countsAsRecentLogin?: boolean
};