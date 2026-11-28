import { type LocaleCode } from '../../localization/models/locale-code.model';
import { type RowShareGrant } from '../../sharing/row-share-grant.model';
import { BaseInvitation } from './base-invitation.model';
import { type InvitationCreateOn } from './invitation-create-on.type';

/**
 * What an invitation is sent with: who is invited where, and the columns of your own of the invitation entity.
 */
export type InvitationCreateData<T extends BaseInvitation = BaseInvitation> = Omit<T, keyof BaseInvitation> & {
    /**
     * The email the invitation is sent to.
     */
    email: string,
    /**
     * The tenant the invitation is to, or undefined for one to the application only.
     */
    tenantId: string | undefined,
    /**
     * The roles the invited person gets: tenant roles of the tenant, or platform roles without one.
     */
    roles: string[],
    /**
     * When the account and the membership are created.
     */
    createOn: InvitationCreateOn,
    /**
     * Whether the invited person may decline it.
     */
    declinable: boolean,
    /**
     * How long the invitation lasts, or undefined for one that lasts until it is answered or revoked.
     */
    expiresInMs: number | undefined,
    /**
     * The locale the invitation is mailed in, and the account it creates gets. Defaults to the locale of the request
     * inviting.
     */
    locale?: LocaleCode,
    /**
     * Whether the account the invitation creates gets no password: accepting takes none, and logs the person
     * accepting in by the link, as `LoginLinkAuthenticator` does. Needs it among the authenticators. False by
     * default.
     */
    withoutPassword?: boolean,
    /**
     * Rows of the tenant to share with the invited person once they accept, each in a role its entity declares. None
     * by default.
     */
    rowShares?: RowShareGrant[]
};