/**
 * Something checking the books of a tenant found: an entry or a line that is not as it was posted, or an entry that
 * does not balance.
 */
export type BookkeepingVerificationProblemModel = {
    /**
     * The id of the entry the problem is of, or null for a problem of a line alone.
     */
    entryId: string | null,
    /**
     * The id of the line the problem is of, or null for a problem of an entry.
     */
    lineId: string | null,
    /**
     * What is wrong.
     */
    reason: string
};
