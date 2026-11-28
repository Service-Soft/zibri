/**
 * A fiscal year of the books of a tenant, as `GET /bookkeeping/fiscal-years` answers it. Its `start` and `end` are
 * days, its first and its last, at midnight UTC.
 */
export type FiscalYearModel = {
    /**
     * The id of the fiscal year.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string,
    /**
     * The first day of the fiscal year.
     */
    start: Date,
    /**
     * The last day of the fiscal year, the balance sheet date.
     */
    end: Date,
    /**
     * When the fiscal year was closed, from which nothing is posted into it, or null for an open one.
     */
    closedAt?: Date | null,
    /**
     * The names of the conformances that apply to the fiscal year, or null for those the legal form of the tenant at
     * its end derives.
     */
    conformances?: string[] | null,
    /**
     * The average number of employees during the fiscal year, such as for the size class of a company, or null while
     * it is not known.
     */
    averageEmployees?: number | null,
    /**
     * The text stated below the balance sheet where the conformances state one, such as a micro corporation, or null
     * for none.
     */
    balanceSheetNote?: string | null,
    /**
     * Whether the company was founded in the fiscal year, for the first fiscal year of the books, or null when it is
     * not said.
     */
    founded?: boolean | null,
    /**
     * The size class the company had at the balance sheet date before the first fiscal year of the books, such as
     * `SMALL`, or null when it is not said.
     */
    previousSizeClass?: string | null,
    /**
     * The sequence of the entry posted into the fiscal year last, or 0 before the first.
     */
    lastSequence: number,
    /**
     * How often the fiscal year was reopened after a closing, 0 for none.
     */
    reopenings: number
};