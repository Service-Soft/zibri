/**
 * A row an approval request was proposed against, as it was stored then. Approving refuses the request once the row
 * holds something else.
 */
export type ApprovalPreconditionModel = {
    /**
     * The table of the row, such as `task`.
     */
    entity: string,
    /**
     * The id of the row.
     */
    id: string,
    /**
     * A hash of what the row held.
     */
    hash: string
};