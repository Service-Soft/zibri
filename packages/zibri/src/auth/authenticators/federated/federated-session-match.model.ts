import { FederatedSession } from './federated-session.model.ts';

/**
 * Which logins a logout at a provider ends: those of the person, or of one session of theirs when
 * `sessionKey` is given.
 */
export type FederatedSessionMatch = Pick<FederatedSession, 'provider' | 'subjectKey' | 'sessionKey'>;