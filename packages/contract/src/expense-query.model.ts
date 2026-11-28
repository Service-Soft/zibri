/**
 * What `GET /bookkeeping/expenses` takes in its query: a page of the expenses, the latest document first, narrowed by
 * what is given. It answers a `PaginationResult` of `ExpenseModel`, with the count of every expense matching.
 */
export type ExpenseQueryModel = {
    /**
     * The page, counting from 1.
     */
    page: number,
    /**
     * How many expenses a page holds, at most 100.
     */
    limit: number,
    /**
     * Only the expenses whose document number or the name of whose supplier contains this text, whatever its case,
     * such as to pick the expense a bank transaction pays.
     */
    search?: string,
    /**
     * The tenant whose expenses are read, for a request with a platform permission naming no tenant.
     */
    tenantId?: string
};