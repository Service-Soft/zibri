/**
 * What a statement of a fiscal year states: the balance sheet the asset, liability and equity accounts at its end,
 * the income statement the revenue and expense accounts over it.
 */
export enum BookkeepingStatementType {
    /**
     * The assets, liabilities and equity at the end of the fiscal year, with its result in equity.
     */
    BALANCE_SHEET = 'BALANCE_SHEET',
    /**
     * The revenue and expenses of the fiscal year, and its result.
     */
    INCOME_STATEMENT = 'INCOME_STATEMENT'
}
