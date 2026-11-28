/**
 * How to close a fiscal year, as `POST /bookkeeping/fiscal-years/:id/closing` takes it.
 */
export type FiscalYearClosingModel = {
    /**
     * The id of the equity account the result of the year, revenue less expenses, is carried into.
     */
    resultAccountId: string
};
