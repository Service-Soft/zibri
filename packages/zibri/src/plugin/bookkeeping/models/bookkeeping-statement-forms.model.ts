/**
 * The forms the statements of a fiscal year are in by default, as the ids of their structures, such as those a
 * conformance resolves from the size class of a company.
 */
export type BookkeepingStatementForms = {
    /**
     * The id of the structure of the balance sheet, such as `hgb.balance-sheet.small`.
     */
    balanceSheet: string,
    /**
     * The id of the structure of the income statement, such as `hgb.income-statement`.
     */
    incomeStatement: string
};
