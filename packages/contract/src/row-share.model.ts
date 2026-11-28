/**
 * A row of a shareable entity shared with a user of the tenant, in a role the entity declares.
 */
export type RowShareModel = {
    /**
     * The id of the share.
     */
    id: string,
    /**
     * The tenant the row belongs to.
     */
    tenantId: string,
    /**
     * The table name of the entity the row is of, such as `project`.
     */
    entity: string,
    /**
     * The id of the row shared.
     */
    rowId: string,
    /**
     * The id of the user it is shared with.
     */
    userId: string,
    /**
     * The role the share grants, such as `viewer` or `editor`.
     */
    role: string,
    /**
     * The id of the user who shared it, or null.
     */
    sharedBy?: string | null,
    /**
     * When it was shared, or its role last changed.
     */
    sharedAt: Date
};
