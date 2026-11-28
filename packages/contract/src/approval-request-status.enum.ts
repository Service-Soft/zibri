/**
 * Where an approval request stands.
 */
export enum ApprovalRequestStatus {
    /**
     * Waiting for a decision.
     */
    PENDING = 'PENDING',
    /**
     * Approved, and its action ran.
     */
    APPROVED = 'APPROVED',
    /**
     * Rejected. Its action did not run.
     */
    REJECTED = 'REJECTED',
    /**
     * Not decided before it expired. Its action did not run.
     */
    EXPIRED = 'EXPIRED',
    /**
     * Approved, and its action failed. Nothing it wrote was kept.
     */
    FAILED = 'FAILED'
}