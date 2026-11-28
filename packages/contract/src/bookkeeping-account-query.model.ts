/**
 * What `GET /bookkeeping/accounts` takes in its query: the accounts of the books, by number, narrowed by what is
 * given. It answers a list of `BookkeepingAccountModel`.
 */
export type BookkeepingAccountQueryModel = {
    /**
     * Only the accounts whose number starts with this text, or whose name contains it, whatever its case, such as
     * `12` for `1200` or `bank`.
     */
    search?: string,
    /**
     * Only the accounts that are not closed, `true`, or only those that are, `false`.
     */
    open?: boolean,
    /**
     * The tenant whose books are read, for a request with a platform permission naming no tenant.
     */
    tenantId?: string
};