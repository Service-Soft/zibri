import { FederatedSessionMatch } from './federated-session-match.model';

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
     * Where the browser goes on to, telling the provider they ended.
     */
    redirectTo: string
} | {
    /**
     * The provider ended its session, after a logout here sent the browser there.
     */
    type: 'response'
};