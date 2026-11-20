/**
 * An open invitation, as a route of the application answers it, without the hash of its token.
 */
export type Invitation = {
    /**
     * The id of the invitation.
     */
    id: string,
    /**
     * The tenant the invitation is to, or null for one to the application only.
     */
    tenantId?: string | null,
    /**
     * The email the invitation is sent to.
     */
    email: string,
    /**
     * The roles the invited person gets: tenant roles of the tenant, or platform roles without one.
     */
    roles: string[],
    /**
     * The id of the user who invited them.
     */
    invitedBy: string,
    /**
     * When the account and the membership are created: right away, or once the invitation is accepted.
     */
    createOn: 'invite' | 'accept',
    /**
     * Whether the invited person may decline it.
     */
    declinable: boolean,
    /**
     * When the link that was mailed stops working.
     */
    tokenExpiresAt: Date,
    /**
     * When the invitation ends, or null for one that lasts until it is answered or revoked.
     */
    expiresAt?: Date | null,
    /**
     * The account the invitation created when it was sent, or null.
     */
    createdUserId?: string | null
};