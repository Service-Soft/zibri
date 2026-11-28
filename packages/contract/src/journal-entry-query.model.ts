/**
 * What `GET /bookkeeping/entries` takes in its query: a page of the entries, by posting date and sequence, narrowed by
 * what is given. It answers a `PaginationResult` of `JournalEntryDetailsModel`, with the count of every entry matching.
 */
export type JournalEntryQueryModel = {
    /**
     * The page, counting from 1.
     */
    page: number,
    /**
     * How many entries a page holds, at most 100.
     */
    limit: number,
    /**
     * Only the entries of this fiscal year.
     */
    fiscalYearId?: string,
    /**
     * Only the entries posted on this day or after, such as `2026-01-01`.
     */
    from?: Date,
    /**
     * Only the entries posted on this day or before, such as `2026-12-31`. On or after `from`.
     */
    until?: Date,
    /**
     * Only the entries with a line on this account of the books.
     */
    accountId?: string,
    /**
     * The tenant whose books are read, for a request with a platform permission naming no tenant.
     */
    tenantId?: string
};