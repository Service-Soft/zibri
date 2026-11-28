import { type ApprovalActorKind } from './approval-actor-kind.enum';
import { type ApprovalPreconditionModel } from './approval-precondition.model';
import { type ApprovalRequestChangeModel } from './approval-request-change.model';
import { type ApprovalRequestStatus } from './approval-request-status.enum';

/**
 * An action proposed for approval, as the approval request routes answer it.
 */
export type ApprovalRequestModel = {
    /**
     * The id of the request.
     */
    id: string,
    /**
     * The tenant the request belongs to.
     */
    tenantId: string,
    /**
     * The name of the action proposed, such as `tasks.close`.
     */
    action: string,
    /**
     * What the action runs with, as its input model describes it.
     */
    input: unknown,
    /**
     * Why the proposer proposes it, if they said.
     */
    reason?: string | null,
    /**
     * What the action does, for the reviewer.
     */
    summary: string,
    /**
     * The rows the action writes, and what it changes on each.
     */
    changes: ApprovalRequestChangeModel[],
    /**
     * The rows the request was proposed against, which approving checks are unchanged.
     */
    preconditions: ApprovalPreconditionModel[],
    /**
     * The id of the user, or the name of the part of the application, that proposed it.
     */
    proposedBy: string,
    /**
     * Whether a user or the system proposed it.
     */
    proposedByKind: ApprovalActorKind,
    /**
     * When it was proposed.
     */
    proposedAt: Date,
    /**
     * Where the request stands.
     */
    status: ApprovalRequestStatus,
    /**
     * When the request expires, unless it is decided before.
     */
    expiresAt: Date
};