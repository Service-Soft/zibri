import { type ApprovalDecisionModel } from './approval-decision.model';
import { type ApprovalRequestModel } from './approval-request.model';

/**
 * An approval request and its decision, as reading, proposing, approving and rejecting one answer it.
 */
export type ApprovalRequestDetailsModel = {
    /**
     * The request.
     */
    request: ApprovalRequestModel,
    /**
     * The decision on it, or null while there is none.
     */
    decision: ApprovalDecisionModel | null
};