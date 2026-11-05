import { FederatedSession } from '../authenticators/federated/federated-session.model';

/**
 * A login a strategy ended.
 */
export type EndedLogin = {
    /**
     * Whose login it was.
     */
    userId: string,
    /**
     * The session at a provider the login was started from, so it can be ended there too. Undefined
     * when it was started some other way.
     */
    federatedSession: FederatedSession | undefined
};