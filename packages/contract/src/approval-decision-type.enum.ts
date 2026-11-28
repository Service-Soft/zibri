/**
 * What was decided on an approval request.
 */
export enum ApprovalDecisionType {
    /**
     * Approved: the action ran, and the decision holds its result or its error.
     */
    APPROVED = 'APPROVED',
    /**
     * Rejected: the action did not run.
     */
    REJECTED = 'REJECTED'
}