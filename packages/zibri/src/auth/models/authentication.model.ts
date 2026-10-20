import { BaseUser } from './base-user.model.ts';
import { FederatedSession } from '../authenticators/federated/federated-session.model.ts';

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
     * The session at a provider the user signed in through, when they did. A strategy keeps it for the
     * whole login, refreshes included, so a logout at the provider can end it.
     */
    federatedSession?: FederatedSession
};