import { FederatedLogoutAnswer } from './federated-logout-answer.model.ts';
import { FederatedSessionMatch } from './federated-session-match.model.ts';

/**
 * What a provider sent the browser to the logout route with.
 */
export type FederatedProviderLogout = {
    /**
     * The user logged out at the provider, and the logins of that session end here too.
     */
    type: 'request',
    /**
     * Which logins end.
     */
    session: FederatedSessionMatch,
    /**
     * How the browser tells the provider they ended. Undefined when the provider takes no answer, and
     * the browser lands on `signedOutUrl`.
     */
    answer: FederatedLogoutAnswer | undefined
} | {
    /**
     * The provider ended its session, after a logout here sent the browser there.
     */
    type: 'response'
};