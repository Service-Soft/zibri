import { type CurrentUser } from '../auth/decorators/current-user.decorator';
import { type BaseInvitation } from '../auth/invitation/base-invitation.model';
import { type Where } from '../data-source/models/where/where-filter.model';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { type BaseEntity } from '../entity/base-entity.model';
import { type DenyAll, type EntityScopeContext } from '../entity/models/entity-scope.model';
import { Newable } from '../types/newable.type';
import { type PendingRowShare } from './pending-row-share.model';
import { type RowShareGrant } from './row-share-grant.model';
import { type RowShare } from './row-share.model';
import { type ShareByEmailResult, type ShareInvitationData } from './share-by-email.model';

/**
 * Interface for the service that shares the rows of shareable entities with selected people, and answers what a
 * caller sees of them. Every method acts in the active tenant.
 */
export interface ShareServiceInterface {
    /**
     * Whether an entity of the application is shareable.
     */
    readonly isEnabled: boolean,
    /**
     * Shares a row with a member of the tenant, or changes the role it is shared with them in.
     * @param entityClass - The shareable entity the row is of.
     * @param rowId - The id of the row.
     * @param userId - The id of the member.
     * @param role - One of the roles the entity declares.
     * @param transaction - The transaction to write in, if any.
     * @returns The share.
     * @throws A BadRequestError for a role the entity does not declare, or a user who is no active member of the
     * tenant, a NotFoundError for a row the tenant does not hold.
     */
    share: (
        entityClass: Newable<BaseEntity>,
        rowId: string,
        userId: string,
        role: string,
        transaction: RepositoryTransaction | undefined
    ) => Promise<RowShare>,
    /**
     * Stops sharing a row with a user. Their account and membership stay; what they see of the rows ends with the next
     * request.
     * @param entityClass - The shareable entity the row is of.
     * @param rowId - The id of the row.
     * @param userId - The id of the user.
     * @param transaction - The transaction to write in, if any.
     */
    unshare: (
        entityClass: Newable<BaseEntity>,
        rowId: string,
        userId: string,
        transaction: RepositoryTransaction | undefined
    ) => Promise<void>,
    /**
     * Finds the shares of a row itself, without those of the rows above it.
     * @param entityClass - The shareable entity the row is of.
     * @param rowId - The id of the row.
     * @returns The shares.
     */
    findShares: (entityClass: Newable<BaseEntity>, rowId: string) => Promise<RowShare[]>,
    /**
     * Finds every share of a user in the tenant, of every shareable entity.
     * @param userId - The id of the user.
     * @returns The shares.
     */
    findSharesOfUser: (userId: string) => Promise<RowShare[]>,
    /**
     * Resolves the role a user holds on a row: the highest of the roles the row and the rows above it are shared with
     * them in. Answers by the shares alone, so a caller with `fullAccess` answers undefined unless something is shared
     * with them, see `validateRole`.
     * @param entityClass - The shareable entity the row is of.
     * @param rowId - The id of the row.
     * @param userId - The id of the user.
     * @returns The role, or undefined when neither the row nor a row above it is shared with them.
     */
    resolveRole: (entityClass: Newable<BaseEntity>, rowId: string, userId: string) => Promise<string | undefined>,
    /**
     * Resolves whether the caller of the request sees every row of an entity: through the `fullAccess` of the
     * shareable entity it is, or is shared through. No outside a request.
     * @param entityClass - A shareable entity, or one shared through a relation.
     * @returns Whether the caller is not restricted to what is shared with them.
     */
    resolveHasFullAccess: (entityClass: Newable<BaseEntity>) => Promise<boolean>,
    /**
     * Validates that the caller of the request holds at least a role on a row, as `@Auth.requireShareRole` does: a
     * caller with `fullAccess` passes, anybody else needs the role or a higher one on the row or a row above it.
     * @param entityClass - The shareable entity the row is of.
     * @param rowId - The id of the row.
     * @param role - The least role needed.
     * @throws A NotFoundError for a row the caller does not see, a ForbiddenError for a lower role.
     */
    validateRole: (entityClass: Newable<BaseEntity>, rowId: string, role: string) => Promise<void>,
    /**
     * Shares a row by email: with the member of the tenant the email belongs to, or by inviting the email into the
     * tenant with the guest roles the invitation names, which creates the share on accepting.
     * @param caller - Who shares, who needs to be allowed to hand out the roles of the invitation.
     * @param entityClass - The shareable entity the row is of.
     * @param rowId - The id of the row.
     * @param email - The email to share it with.
     * @param role - One of the roles the entity declares.
     * @param invitation - The invitation, for an email that is no member of the tenant.
     * @param transaction - The transaction to write in, if any.
     * @returns The share, or the invitation carrying it.
     * @throws What `share` and `InvitationServiceInterface.invite` throw.
     */
    shareByEmail: <T extends BaseInvitation>(
        caller: CurrentUser,
        entityClass: Newable<BaseEntity>,
        rowId: string,
        email: string,
        role: string,
        invitation: ShareInvitationData<T>,
        transaction: RepositoryTransaction | undefined
    ) => Promise<ShareByEmailResult<T>>,
    /**
     * Validates the shares an invitation into the active tenant carries, as it is sent.
     * @param grants - The shares.
     * @param transaction - The transaction to read in, if any.
     * @returns The shares, as the invitation stores them.
     * @throws A BadRequestError for an entity that is not shareable or a role it does not declare, a NotFoundError for
     * a row the tenant does not hold.
     */
    resolvePendingShares: (grants: RowShareGrant[], transaction: RepositoryTransaction | undefined) => Promise<PendingRowShare[]>,
    /**
     * Creates the shares an invitation into the active tenant carries, for the user accepting it.
     * @param userId - The id of the user.
     * @param pending - The shares, as the invitation stores them.
     * @param sharedBy - The id of the user who invited them.
     * @param transaction - The transaction of the acceptance.
     */
    createPendingShares: (
        userId: string,
        pending: PendingRowShare[],
        sharedBy: string,
        transaction: RepositoryTransaction | undefined
    ) => Promise<void>,
    /**
     * Resolves the rows of a shareable entity, or of one shared through a relation, the caller a scope decides for
     * sees, as every repository call on it is narrowed by.
     * @param entityClass - The entity.
     * @param context - What the scopes of the call are told about the caller.
     * @param transaction - The transaction of the call, if any.
     * @returns The filter, `denyAll` for a caller who sees no row, undefined for one with `fullAccess`.
     */
    resolveRestriction: (
        entityClass: Newable<BaseEntity>,
        context: EntityScopeContext,
        transaction: RepositoryTransaction | undefined
    ) => Promise<Where<BaseEntity> | DenyAll | undefined>,
    /**
     * Deletes every share of the given users, in every tenant. Called in the transaction that deletes the users for
     * good.
     * @param userIds - The ids of the users.
     * @param transaction - The transaction deleting them.
     */
    deleteUserRows: (userIds: string[], transaction: RepositoryTransaction) => Promise<void>
}