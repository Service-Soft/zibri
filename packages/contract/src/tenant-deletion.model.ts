/**
 * The deletion of a tenant, with how far it got.
 */
export type TenantDeletion = {
    /**
     * The id of the deletion.
     */
    id: string,
    /**
     * The id of the tenant.
     */
    tenantId: string,
    /**
     * When the deletion started.
     */
    startedAt: Date,
    /**
     * The entity whose rows are being deleted, or null.
     */
    deletingEntity?: string | null,
    /**
     * How many rows were deleted so far.
     */
    deletedRows: number,
    /**
     * When the tenant itself was deleted, or null while the deletion goes on.
     */
    finishedAt?: Date | null
};