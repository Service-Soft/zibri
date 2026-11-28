import { LocaleCode } from './locale-code.type';
import { PendingRowShareModel } from './pending-row-share.model';

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
    createdUserId?: string | null,
    /**
     * The locale the invitation is mailed in, such as `de`, and the account it creates gets. Null for the default
     * locale of the application.
     */
    locale?: LocaleCode | null,
    /**
     * Whether the account the invitation creates gets no password, and accepting logs the invited person in. Null for
     * an invitation that takes a password.
     */
    withoutPassword?: boolean | null,
    /**
     * The rows shared with the invited person once they accept, or null for an invitation sharing nothing.
     */
    rowShares?: PendingRowShareModel[] | null
};