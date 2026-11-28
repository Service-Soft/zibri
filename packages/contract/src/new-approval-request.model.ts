/**
 * An action to propose, as `POST /` of the approval request routes takes it.
 */
export type NewApprovalRequestModel = {
    /**
     * The name of the action, such as `tasks.close`.
     */
    action: string,
    /**
     * What the action runs with, as its input model describes it.
     */
    input: unknown,
    /**
     * Why it is proposed, for the reviewer.
     */
    reason?: string | null
};