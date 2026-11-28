/**
 * What approving or rejecting an approval request takes.
 */
export type ApprovalDecisionInputModel = {
    /**
     * A note for the proposer, such as why it was rejected.
     */
    note?: string | null
};