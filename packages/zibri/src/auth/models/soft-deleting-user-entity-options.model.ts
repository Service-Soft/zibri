/**
 * What `BaseUserEntity` asks of a user entity that soft deletes.
 */
export type SoftDeletingUserEntityOptions = {
    /**
     * Whether a soft deleted user keeps their email taken. `false` frees it, so someone can register
     * again with the same address, and restoring the user fails with a `UniqueConstraintViolationError`
     * when another took it meanwhile. `true` keeps it taken for good.
     */
    deletedUserKeepsEmail: boolean
};