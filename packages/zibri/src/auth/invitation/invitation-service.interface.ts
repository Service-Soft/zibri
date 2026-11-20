import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { type CurrentUser } from '../decorators/current-user.decorator';
import { BaseInvitation } from './base-invitation.model';
import { InvitationAcceptance } from './invitation-acceptance.model';
import { InvitationCreateData } from './invitation-create-data.model';
import { InvitationTokenValidity } from './invitation-token-validity.model';

/**
 * Interface for the service that invites people to the application, or to a tenant with roles there.
 */
export interface InvitationServiceInterface {
    /**
     * Whether the application lists an invitation repository, without which it has no invitations.
     */
    readonly isEnabled: boolean,
    /**
     * Invites somebody, and mails them the link. The roles are checked like `assignRole` of the `RoleService`
     * checks them, so nobody invites into more than they may hand out. With `createOn` `'invite'`, the account,
     * if the email has none, and the membership are created at once.
     * @param caller - Who invites.
     * @param data - Who is invited where.
     * @param transaction - The transaction to write in, if any.
     * @returns The invitation.
     * @throws A ForbiddenError when the caller may not hand out the roles, a ConflictError when the email has an
     * open invitation there or is a member of the tenant already.
     */
    invite: <T extends BaseInvitation>(
        caller: CurrentUser,
        data: InvitationCreateData<T>,
        transaction: RepositoryTransaction | undefined
    ) => Promise<T>,
    /**
     * Mails an invitation again, with a new link. The previous link stops working.
     * @param id - The id of the invitation, which the repository reads in the active tenant.
     * @param transaction - The transaction to write in, if any.
     * @throws A NotFoundError when there is no such invitation.
     */
    resend: (id: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Withdraws an invitation. What it created when it was sent goes with it: the membership, and the account
     * while nobody verified its email, it belongs to no tenant and no other invitation is open for its email.
     * @param id - The id of the invitation, which the repository reads in the active tenant.
     * @param transaction - The transaction to write in, if any.
     * @throws A NotFoundError when there is no such invitation.
     */
    revoke: (id: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Finds the open invitations of the active tenant, or those to the application only while no tenant is
     * active.
     * @returns The invitations.
     */
    findInvitations: <T extends BaseInvitation>() => Promise<T[]>,
    /**
     * Resolves whether the link of an invitation still works, and what accepting it takes. A link that expired is
     * renewed or refused, as `ZIBRI_DI_TOKENS.INVITATION_OPTIONS` says.
     * @param token - The token of the link.
     * @returns Whether it works.
     */
    resolveTokenValidity: (token: string) => Promise<InvitationTokenValidity>,
    /**
     * Accepts an invitation: creates the account, if the email has none, with the password, and the membership,
     * and gives the roles. An email with an account of its own is accepted by that account only. Marks the email
     * as verified, since the link reached it.
     * @param token - The token of the link.
     * @param acceptance - Who accepts, and with what.
     * @param transaction - The transaction to write in, if any.
     * @throws An UnauthorizedError for a link that does not work, or an email with an account while nobody is
     * logged in, a ForbiddenError while somebody else is logged in, a BadRequestError for a password that is
     * missing or given where it is not taken.
     */
    accept: (token: string, acceptance: InvitationAcceptance, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Declines an invitation, and undoes what it created like `revoke`.
     * @param token - The token of the link.
     * @param transaction - The transaction to write in, if any.
     * @throws An UnauthorizedError for a link that does not work, a ForbiddenError for an invitation that may not
     * be declined.
     */
    decline: (token: string, transaction: RepositoryTransaction | undefined) => Promise<void>
}