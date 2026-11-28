/**
 * A fiscal year to add to the books of a tenant, as `POST /bookkeeping/fiscal-years` takes it. Days are written as
 * `2026-01-01`.
 */
export type NewFiscalYearModel = {
    /**
     * The first day. The day after the end of the fiscal year before it by default, and required for the first.
     */
    start?: Date | null,
    /**
     * The last day. The day before the same day a year after the start by default, or the end of the calendar year of
     * the start for the first fiscal year.
     */
    end?: Date | null,
    /**
     * The names of the conformances that apply, in place of those the legal form of the tenant at the end derives.
     */
    conformances?: string[] | null,
    /**
     * The average number of employees during the fiscal year, or null while it is not known.
     */
    averageEmployees?: number | null,
    /**
     * The text stated below the balance sheet where the conformances state one, such as a micro corporation, or null
     * for none.
     */
    balanceSheetNote?: string | null,
    /**
     * Whether the company was founded in the fiscal year, for the first fiscal year of the books.
     */
    founded?: boolean | null,
    /**
     * The size class the company had at the balance sheet date before the first fiscal year of the books, such as
     * `SMALL`.
     */
    previousSizeClass?: string | null
};
