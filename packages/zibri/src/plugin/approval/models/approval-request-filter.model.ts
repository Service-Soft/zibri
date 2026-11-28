import { type ApprovalRequestStatus } from './approval-request-status.enum';

/**
 * Which approval requests `findRequests` answers. Every request of the active tenant by default.
 */
export type ApprovalRequestFilter = {
    /**
     * Only the requests of this status.
     */
    status?: ApprovalRequestStatus,
    /**
     * Only the requests of this action.
     */
    action?: string
};