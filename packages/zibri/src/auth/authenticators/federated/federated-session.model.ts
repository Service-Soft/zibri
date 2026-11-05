/**
 * The session at a provider a login was started from, which the login keeps for as long as it lasts.
 *
 * A strategy stores it with the login, so that a logout at the provider ends the logins it started,
 * and a logout here can end the session at the provider.
 */
export type FederatedSession = {
    /**
     * The name of the authenticator of the provider.
     */
    provider: string,
    /**
     * Identifies the person at the provider, without naming them: a hash of the issuer and the subject.
     */
    subjectKey: string,
    /**
     * Identifies the one session at the provider: a hash of the issuer, the subject and the provider's
     * id of the session. Undefined when the provider names no session.
     */
    sessionKey: string | undefined,
    /**
     * What the authenticator needs to end the session at the provider, in its own words. Undefined when
     * the provider cannot be told.
     */
    logout: string | undefined
};