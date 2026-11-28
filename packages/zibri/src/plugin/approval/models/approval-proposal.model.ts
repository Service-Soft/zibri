/**
 * What `propose` of the approval request service takes.
 */
export type ApprovalProposal = {
    /**
     * The name of the action, such as `tasks.close`.
     */
    action: string,
    /**
     * What the action runs with, validated against its input model.
     */
    input: unknown,
    /**
     * Why it is proposed, for the reviewer.
     */
    reason?: string | null,
    /**
     * The part of the application proposing it, such as `bank-matching`, which needs no permission. The logged in
     * user of the request proposes it when it is not given.
     */
    system?: string
};