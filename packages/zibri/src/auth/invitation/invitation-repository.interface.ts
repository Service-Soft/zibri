import { INVITATION_REPOSITORY } from '../../data-source/repository/repository-kind.model';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { BaseUser } from '../models/base-user.model';
import { BaseInvitation } from './base-invitation.model';

// methods rather than properties holding functions, for the reason UserRepositoryInterface gives
/* eslint-disable typescript/method-signature-style */
/**
 * Interface for an invitation repository, the one place the invitations of an application are read from and
 * written to, which also says how the account of an invitation is created.
 */
export interface InvitationRepositoryInterface<InvitationType extends BaseInvitation> {
    /**
     * Marks the repository as the one invitations are read from and written to.
     */
    readonly [INVITATION_REPOSITORY]: true,
    /**
     * Creates the user an invitation is for, whose email has no account: when it is sent with `createOn`
     * `'invite'`, or when it is accepted with `'accept'`. The user holds the email of the invitation, and the
     * platform roles every user of the application starts with. The roles of the invitation are given to them
     * afterwards.
     * @param invitation - The invitation, with the columns of your own it was sent with.
     * @param transaction - The transaction the invitation is sent or accepted in, if any.
     * @returns The user.
     */
    createInvitedUser(invitation: InvitationType, transaction: RepositoryTransaction | undefined): Promise<BaseUser<string>>
}
/* eslint-enable typescript/method-signature-style */

/**
 * Checks whether or not the given value is an invitation repository.
 * @param value - The value to check.
 * @returns True if the value carries the mark of InvitationRepositoryInterface, false otherwise.
 */
export function isInvitationRepository(value: unknown): value is InvitationRepositoryInterface<BaseInvitation> {
    return value != undefined && typeof value === 'object' && INVITATION_REPOSITORY in value;
}