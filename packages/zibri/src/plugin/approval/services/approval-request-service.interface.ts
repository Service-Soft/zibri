import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type ApprovalAction } from '../models/approval-action.model';
import { type ApprovalProposal } from '../models/approval-proposal.model';
import { type ApprovalRequestDetails } from '../models/approval-request-details.model';
import { type ApprovalRequestFilter } from '../models/approval-request-filter.model';
import { type ApprovalRequest } from '../models/approval-request.model';

/**
 * Proposes actions for approval, decides them, and reads them, in the active tenant.
 */
export interface ApprovalRequestServiceInterface {
    /**
     * Finds the registered action of the given name.
     */
    findAction: (name: string) => ApprovalAction | undefined,
    /**
     * Proposes an action: validates the input, stores the request with what the action would do, and asks the
     * policies of the action whether one approves it. Proposed by the logged in user of the request, who needs the
     * `proposePermission` of the action, or by the `system` the proposal names.
     * @throws A `BadRequestError` for an action that is not registered, a `ValidationError` for an input that is not
     * one of its model, and a `ForbiddenError` for a user without the permission.
     */
    propose: (proposal: ApprovalProposal) => Promise<ApprovalRequestDetails>,
    /**
     * Approves a request as the logged in user of the request: checks the `permission` of its action, a second factor
     * where the action requires one, and that the rows it was proposed against are unchanged, runs the action once and
     * records the decision with what it answered. A request whose action fails is `FAILED`, with the error.
     * @throws A `ForbiddenError` for the proposer of the request and for a user without the permission, and a
     * `ConflictError` for a request that is not pending, expired or whose rows changed.
     */
    approve: (requestId: string, note?: string | null) => Promise<ApprovalRequestDetails>,
    /**
     * Rejects a request as the logged in user of the request, who needs the `permission` of its action, and records
     * the note.
     * @throws A `ForbiddenError` for a user without the permission, and a `ConflictError` for a request that is not
     * pending or expired.
     */
    reject: (requestId: string, note?: string | null) => Promise<ApprovalRequestDetails>,
    /**
     * Finds a request and its decision.
     */
    findRequest: (requestId: string) => Promise<ApprovalRequestDetails | undefined>,
    /**
     * Finds a page of the requests the filter matches, the latest proposed first.
     */
    findRequests: (page: number, limit: number, filter: ApprovalRequestFilter) => Promise<PaginationResult<ApprovalRequest>>,
    /**
     * Closes the pending requests of every tenant that expired, as `EXPIRED`.
     * @returns How many were closed.
     */
    closeExpiredRequests: () => Promise<number>
}