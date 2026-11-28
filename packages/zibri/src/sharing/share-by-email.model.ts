import { type BaseInvitation } from '../auth/invitation/base-invitation.model';
import { type InvitationCreateData } from '../auth/invitation/invitation-create-data.model';
import { type RowShare } from './row-share.model';

/**
 * The invitation a row is shared by email with, for an email that is no member of the tenant: the guest `roles` the
 * membership gets, when it is created and how long it lasts, and the columns of your own of the invitation entity.
 */
// the columns of your own beside the fields of every invitation, the way InvitationCreateData puts them, so that the
// email, tenant and shares put back make one of those
export type ShareInvitationData<T extends BaseInvitation = BaseInvitation> = Omit<T, keyof BaseInvitation>
    & Pick<InvitationCreateData, 'roles' | 'createOn' | 'declinable' | 'expiresInMs' | 'locale' | 'withoutPassword'>;

/**
 * What sharing a row by email did: shared it with the member the email belongs to, or invited the email with the
 * share, which is created once the invitation is accepted.
 */
export type ShareByEmailResult<T extends BaseInvitation = BaseInvitation> = {
    /**
     * The share, for an email of a member of the tenant.
     */
    share: RowShare,
    /**
     * Undefined, as the member needs no invitation.
     */
    invitation: undefined
} | {
    /**
     * Undefined, as the share is created once the invitation is accepted.
     */
    share: undefined,
    /**
     * The invitation carrying the share.
     */
    invitation: T
};
