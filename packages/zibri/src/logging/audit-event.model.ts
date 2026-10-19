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
     * Locking a user's second factor after too many wrong codes in a row.
     */
    TWO_FACTOR_LOCKED = 'auth.2fa.locked',
    /**
     * Removing every second factor of a user and lifting a lock: by a recovery code, which removes the
     * locked ones, or by a reset, which removes all of them.
     */
    TWO_FACTOR_RESET = 'auth.2fa.reset',
    /**
     * Linking an identity at a provider to a user who already exists, which it signs in as from then on.
     */
    IDENTITY_LINKED = 'auth.identity.linked',
    /**
     * Unlinking an identity at a provider from a user.
     */
    IDENTITY_UNLINKED = 'auth.identity.unlinked',
    /**
     * Stopping an identity at a provider from signing in as its user, which stays linked for the
     * provider's apis.
     */
    IDENTITY_SIGN_IN_REVOKED = 'auth.identity.sign-in-revoked',
    /**
     * Starting to keep a provider's tokens for an identity, which lets the application call the
     * provider's apis for the user it is linked to.
     */
    PROVIDER_ACCESS_GRANTED = 'auth.provider-access.granted',
    /**
     * Stopping to keep a provider's tokens for an identity: removed by the application, or refused by
     * the provider.
     */
    PROVIDER_ACCESS_REVOKED = 'auth.provider-access.revoked',
    /**
     * Creating an api key, which acts as its user until it expires or is revoked.
     */
    API_KEY_CREATED = 'auth.api-key.created',
    /**
     * Revoking one or every api key of a user.
     */
    API_KEY_REVOKED = 'auth.api-key.revoked',
    /**
     * A client asking the authorization server for an access token with its api key.
     */
    TOKEN_ISSUED = 'auth.token.issued',
    /**
     * Revoking an access or refresh token at the authorization server.
     */
    TOKEN_REVOKED = 'auth.token.revoked',
    /**
     * Deactivating a user, which ends their logins and revokes their api keys.
     */
    USER_DEACTIVATED = 'auth.user.deactivated',
    /**
     * Reactivating a deactivated user.
     */
    USER_REACTIVATED = 'auth.user.reactivated',
    /**
     * Ending every login and revoking every api key of a user who stays active, such as one whose
     * entry was disabled in a directory.
     */
    ACCESS_ENDED = 'auth.access.ended',
    /**
     * An identity provider provisioning a user through SCIM.
     */
    SCIM_USER_CREATED = 'scim.user.created',
    /**
     * An identity provider changing a user it provisioned.
     */
    SCIM_USER_UPDATED = 'scim.user.updated',
    /**
     * An identity provider deleting a user it provisioned.
     */
    SCIM_USER_DELETED = 'scim.user.deleted',
    /**
     * An identity provider provisioning a group through SCIM.
     */
    SCIM_GROUP_CREATED = 'scim.group.created',
    /**
     * An identity provider changing a group it provisioned, its members included.
     */
    SCIM_GROUP_UPDATED = 'scim.group.updated',
    /**
     * An identity provider deleting a group it provisioned.
     */
    SCIM_GROUP_DELETED = 'scim.group.deleted',
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
     * A credential was presented by what looks like a copy of the device it lives on: a passkey
     * whose signature counter went backwards.
     *
     * Either the device was cloned, or its counter is broken. Like a reused token, worth a look.
     */
    CREDENTIAL_CLONED = 'credential-cloned',
    /**
     * The credentials were right, but the user is deactivated.
     */
    DEACTIVATED = 'deactivated',
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
     * The caller is logged in, and is no member of the tenant the request is for - or acts through a
     * credential bound to another tenant.
     */
    NOT_A_MEMBER = 'not-a-member',
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
     * A browser sent a request changing something from a page on another origin, with cookies
     * attached, and that origin may not send credentials.
     */
    CROSS_ORIGIN = 'cross-origin',
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
    userId?: string,
    /**
     * The scopes of a provider's apis the access granted or revoked covers.
     */
    scopes?: string[]
};