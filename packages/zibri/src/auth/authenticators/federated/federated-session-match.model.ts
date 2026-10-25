import { FederatedSession } from './federated-session.model';

/**
 * Which logins a logout at a provider ends: those of the person, when `subjectKey` is given, those of
 * one session of theirs, when `sessionKey` is given, or those of that session of that person, when both are.
 *
 * At least one of the two is given.
 */
export type FederatedSessionMatch = Pick<FederatedSession, 'provider' | 'sessionKey'> & {
    /**
     * Identifies the person at the provider, or undefined when the logout names the session alone.
     */
    subjectKey: string | undefined
};