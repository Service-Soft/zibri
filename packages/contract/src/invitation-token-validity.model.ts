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
    declinable: boolean
};