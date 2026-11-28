/**
 * A form a statement of a fiscal year can be shown in, as `GET /bookkeeping/fiscal-years/:id/statement-forms` answers
 * it.
 */
export type BookkeepingStatementFormModel = {
    /**
     * The id of the form, which `GET /bookkeeping/reports/balance-sheet` and `GET /bookkeeping/reports/income-statement`
     * take as their `form`, such as `hgb.balance-sheet.small`.
     */
    id: string,
    /**
     * The name of the form, telling it from the other forms of its statement, in the locale of the request.
     */
    name: string
};
