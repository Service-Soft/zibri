/**
 * What a security relevant event was about.
 *
 * The pair of `action` and `outcome` is what a rule keys on; everything else on the event is there
 * to answer the follow up question once a rule has fired.
 */
export enum AuditAction {
    /**
     * A login attempt with credentials.
     */
    LOGIN = 'auth.login',
    /**
     * Exchanging a refresh credential for a new one.
     */
    REFRESH_LOGIN = 'auth.refresh-login',
    /**
     * Ending a session.
     */
    LOGOUT = 'auth.logout',
    /**
     * Asking for a password reset link.
     */
    PASSWORD_RESET_REQUESTED = 'auth.password-reset.requested',
    /**
     * Setting a new password by presenting a reset token.
     */
    PASSWORD_RESET_CONFIRMED = 'auth.password-reset.confirmed',
    /**
     * Presenting a second factor.
     */
    TWO_FACTOR = 'auth.2fa',
    /**
     * Deciding whether a caller may reach a route.
     */
    AUTHORIZATION = 'authz.check',
    /**
     * Refusing a caller because they asked too often.
     *
     * The one client error that is a security event in its own right: a run of these is what
     * credential stuffing, scraping and brute forcing look like from the outside, whatever endpoint
     * they are aimed at. Recorded where the refusal becomes a response, so an internal limiter that
     * the application handles itself - outbound mail waiting its turn, say - stays out of the trail.
     */
    RATE_LIMITED = 'ratelimit.exceeded'
}

/**
 * Whether the thing that was attempted happened.
 */
export enum AuditOutcome {
    SUCCESS = 'success',
    FAILURE = 'failure'
}

/**
 * Why an attempt did not succeed.
 *
 * A closed set rather than a message, because this is the field a detection rule reads. Messages
 * are localized and are allowed to change wording; these values are not.
 */
export enum AuditReason {
    /**
     * What was presented - credentials, a token, a second factor - was not accepted.
     *
     * Deliberately one value rather than several. Which half of a login was wrong is exactly what
     * the endpoint refuses to tell the caller, and recording it would put the distinction in a table
     * instead.
     */
    REFUSED = 'refused',
    /**
     * A refresh credential that had already been exchanged was presented again.
     *
     * The one entry here that means something specific happened rather than something merely failed:
     * either a credential was stolen, or a client is replaying. Both are worth waking someone.
     */
    TOKEN_REUSED = 'token-reused',
    /**
     * The account the attempt named does not exist.
     *
     * Recorded where the api deliberately answers as though it did - a password reset for an unknown
     * address is the case in point. The caller cannot tell the difference, which is the whole design;
     * this is the only place the difference survives, and a run of these is what probing for accounts
     * looks like.
     */
    NO_SUCH_SUBJECT = 'no-such-subject',
    /**
     * The route needs a logged in caller and there was none.
     */
    NOT_LOGGED_IN = 'not-logged-in',
    /**
     * The route needs an anonymous caller and the request carried a credential.
     */
    ALREADY_LOGGED_IN = 'already-logged-in',
    /**
     * The caller is logged in but holds none of the roles the route allows.
     */
    MISSING_ROLE = 'missing-role',
    /**
     * The caller tried to write a row outside what the entity's scope lets them see.
     *
     * Writes only. A refused *read* cannot be recorded, because a scoped query that comes back empty
     * is indistinguishable from one whose rows simply do not exist - which is the property that keeps
     * a scoped route from telling anyone which ids are real.
     */
    OUT_OF_SCOPE = 'out-of-scope',
    /**
     * The route needs a second factor and the session has not presented one.
     */
    SECOND_FACTOR_MISSING = 'second-factor-missing',
    /**
     * Something broke rather than refused.
     *
     * Kept apart from `REFUSED` on purpose: a user store that is down answers every request exactly
     * like a wrong password, and a log that cannot tell them apart turns an outage into what looks
     * like a credential stuffing run.
     */
    ERROR = 'error'
}

/**
 * A security relevant event, as handed to `LoggerInterface.audit`.
 */
export type AuditEvent = {
    /**
     * What was attempted.
     */
    action: AuditAction,
    /**
     * Whether it happened.
     */
    outcome: AuditOutcome,
    /**
     * Why it did not, when it did not.
     */
    reason?: AuditReason,
    /**
     * The account the attempt named, as the caller spelled it.
     *
     * Recorded for attempts that failed too, and that is the point: one address tried from many
     * clients and many addresses tried from one client are different attacks, and neither is visible
     * without this. It is whatever was submitted, so a failed attempt does not imply the account
     * exists.
     */
    subject?: string,
    /**
     * The id of the account, once the attempt got far enough to resolve one.
     */
    userId?: string
};