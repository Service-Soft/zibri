/**
 * A row an invitation shares with the invited person once they accept.
 */
export type PendingRowShareModel = {
    /**
     * The table name of the entity the row is of, such as `project`.
     */
    entity: string,
    /**
     * The id of the row shared.
     */
    rowId: string,
    /**
     * The role the share grants.
     */
    role: string
};
