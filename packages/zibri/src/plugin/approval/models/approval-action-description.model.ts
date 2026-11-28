import { type ApprovalRowChange } from './approval-row-change.model';

/**
 * What an action would do with an input, as its `describe` answers it for the reviewer.
 */
export type ApprovalActionDescription = {
    /**
     * One sentence for the reviewer, such as `Close the task "Write the release notes"`.
     */
    summary: string,
    /**
     * The rows the action writes. Each one that is stored becomes a precondition of the request. None by default.
     */
    rows?: ApprovalRowChange[]
};