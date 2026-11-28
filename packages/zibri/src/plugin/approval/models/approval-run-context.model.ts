import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type ApprovalActorKind } from './approval-actor-kind.enum';
import { type ApprovalRequest } from './approval-request.model';

/**
 * What the `run` of an approved action is handed besides its input.
 */
export type ApprovalRunContext = {
    /**
     * The transaction the decision is recorded in, of the data source of the approval requests. What the action writes
     * through it is kept only when the action succeeds.
     */
    transaction: Transaction,
    /**
     * The request approved.
     */
    request: ApprovalRequest,
    /**
     * The id of the user, or the name of the policy, that approved it.
     */
    decidedBy: string,
    /**
     * Whether a user or a policy approved it.
     */
    decidedByKind: ApprovalActorKind
};