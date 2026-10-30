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
     * A login whose credentials were accepted and that waits for its second factor.
     */
    LOGIN_PENDING = 'auth.login.pending',
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
     * Locking an account after too many wrong passwords in a row.
     */
    PASSWORD_LOCKED = 'auth.password.locked',
    /**
     * Changing a password by presenting the current one.
     */
    PASSWORD_CHANGED = 'auth.password.changed',
    /**
     * A user ending one of their logins, such as one on a device they lost.
     */
    LOGIN_ENDED = 'auth.login.ended',
    /**
     * A user ending every one of their logins.
     */
    LOGINS_ENDED = 'auth.logins.ended',
    /**
     * Verifying the email address of a user, by a link mailed to it.
     */
    EMAIL_VERIFIED = 'auth.email.verified',
    /**
     * Asking to change the email address of a user, which mails a link to the new one.
     */
    EMAIL_CHANGE_REQUESTED = 'auth.email.change-requested',
    /**
     * Changing the email address of a user, by a link mailed to the new one.
     */
    EMAIL_CHANGED = 'auth.email.changed',
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
     * Confirming a second factor a user enrolls, which they present from then on.
     */
    TWO_FACTOR_ENROLLED = 'auth.2fa.enrolled',
    /**
     * Removing one second factor of a user.
     */
    TWO_FACTOR_REMOVED = 'auth.2fa.removed',
    /**
     * Linking an identity at a provider to a user who already exists, which it logs in as from then on.
     */
    IDENTITY_LINKED = 'auth.identity.linked',
    /**
     * Unlinking an identity at a provider from a user.
     */
    IDENTITY_UNLINKED = 'auth.identity.unlinked',
    /**
     * Stopping an identity at a provider from logging in as its user, which stays linked for the
     * provider's apis.
     */
    IDENTITY_LOGIN_REVOKED = 'auth.identity.login-revoked',
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
     * Creating a role.
     */
    ROLE_CREATED = 'auth.role.created',
    /**
     * Changing what a role carries, or what the application keeps about it.
     */
    ROLE_UPDATED = 'auth.role.updated',
    /**
     * Deleting a role.
     */
    ROLE_DELETED = 'auth.role.deleted',
    /**
     * Giving a user a role, of their own or through their membership in a tenant.
     */
    ROLE_ASSIGNED = 'auth.role.assigned',
    /**
     * Taking a role from a user, of their own or from their membership in a tenant.
     */
    ROLE_UNASSIGNED = 'auth.role.unassigned',
    /**
     * Deactivating a user's membership in a tenant, which takes the tenant and their roles in it away
     * until it is reactivated. Recorded in that tenant.
     */
    MEMBERSHIP_DEACTIVATED = 'auth.membership.deactivated',
    /**
     * Reactivating a deactivated membership. Recorded in its tenant.
     */
    MEMBERSHIP_REACTIVATED = 'auth.membership.reactivated',
    /**
     * Deleting a user's membership in a tenant, and their roles in it with it. Recorded in that tenant.
     */
    MEMBERSHIP_DELETED = 'auth.membership.deleted',
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
 * This is the field a detection rule reads. Messages are localized and are allowed to change
 * wording; these values are not.
 */
export enum AuditReason {
    // deliberately one value rather than several. Which half of a login was wrong is exactly what the
    // endpoint refuses to tell the caller, and recording it would put the distinction in a table
    // instead
    /**
     * What was presented - credentials, a token, a second factor - was not accepted. Which part of it
     * was wrong is not recorded.
     */
    REFUSED = 'refused',
    /**
     * A refresh credential that had already been exchanged was presented again.
     *
     * Either a credential was stolen, or a client is replaying. Both are worth waking someone.
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
     * The password was right, but the account is locked after too many wrong ones in a row.
     *
     * Recorded where the api answers as though the password were wrong, so that the lock is visible
     * somewhere.
     */
    LOCKED = 'locked',
    /**
     * The account the attempt named does not exist.
     *
     * Recorded where the api answers as though it did - a password reset for an unknown address is
     * the case in point. The caller cannot tell the difference; this is the only place it survives,
     * and a run of these is what probing for accounts looks like.
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
     * The caller is logged in but none of their roles carries the permission the route needs.
     */
    MISSING_PERMISSION = 'missing-permission',
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
     * A request changing something carried a valid cookie session, and not the csrf token that goes
     * with it.
     */
    CSRF = 'csrf',
    /**
     * What was asked for needs a verified email address, and the user's is not.
     */
    EMAIL_NOT_VERIFIED = 'email-not-verified',
    // kept apart from `REFUSED` on purpose: a user store that is down answers every request exactly
    // like a wrong password, and a log that cannot tell them apart turns an outage into what looks
    // like a credential stuffing run
    /**
     * Something broke: the attempt was not refused, it could not be answered.
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
    scopes?: string[],
    /**
     * The role created, changed, deleted, given or taken. `subject` is the user it was given to or
     * taken from, and `userId` who did it.
     */
    role?: string
};