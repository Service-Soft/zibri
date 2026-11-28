/**
 * A change of an open fiscal year, as `PATCH /bookkeeping/fiscal-years/:id` takes it. Each property is unchanged when
 * absent.
 */
export type FiscalYearChangeModel = {
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
     * Whether the company was founded in the fiscal year, for the first fiscal year of the books.
     */
    founded?: boolean | null,
    /**
     * The size class the company had at the balance sheet date before the first fiscal year of the books, such as
     * `SMALL`.
     */
    previousSizeClass?: string | null
};
