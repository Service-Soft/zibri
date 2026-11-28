/**
 * What `POST /verify-invitation-token` answers.
 */
export type InvitationTokenValidity = {
    /**
     * Whether the link of the invitation still works.
     */
    isValid: boolean,
    /**
     * Whether the link had expired and a new one was mailed to the invited address.
     */
    renewed: boolean,
    /**
     * The invited email, for a link that works.
     */
    email?: string,
    /**
     * The tenant the invitation is to, for a link that works and an invitation to a tenant.
     */
    tenantId?: string,
    /**
     * Whether accepting needs a login as the account of the email. When false, accepting takes the password of the
     * account instead.
     */
    requiresLogin: boolean,
    /**
     * Whether the invited person may decline it.
     */
    declinable: boolean,
    /**
     * Whether the account the invitation creates gets no password: accepting takes none, and answers a login like
     * the login route, or the refusal of a login that waits for a second factor. False where accepting needs a
     * login. Undefined, from an application whose invitation service predates it, means false.
     */
    // TODO 4.0: required. Optional until then, so that a validity built for 3.2 stays one
    withoutPassword?: boolean
};