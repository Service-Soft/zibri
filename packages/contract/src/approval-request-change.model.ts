import { type ApprovalValueChangeModel } from './approval-value-change.model';

/**
 * A row an approval request would write, and what it would change on it.
 */
export type ApprovalRequestChangeModel = {
    /**
     * The table of the row, such as `task`.
     */
    entity: string,
    /**
     * The id of the row, or null for a row the action creates.
     */
    id: string | null,
    /**
     * The values the action changes, each against the value stored when the request was proposed.
     */
    changes: ApprovalValueChangeModel[]
};