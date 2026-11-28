import { type ApprovalRequestStatus } from './approval-request-status.enum';

/**
 * What an event about an approval request carries, such as one emitted when it is proposed or decided.
 */
export type ApprovalRequestEventData = {
    /**
     * The id of the request.
     */
    requestId: string,
    /**
     * The name of its action.
     */
    action: string,
    /**
     * Where it stands.
     */
    status: ApprovalRequestStatus
};