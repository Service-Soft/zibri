import { FederatedSessionMatch } from './federated-session-match.model';

/**
 * What a provider sent server to server to the `logout/soap` route: that the user logged out there.
 */
export type FederatedSoapLogout = {
    /**
     * Which logins end.
     */
    session: FederatedSessionMatch,
    /**
     * The SOAP envelope the provider is answered with.
     */
    answer: string
};