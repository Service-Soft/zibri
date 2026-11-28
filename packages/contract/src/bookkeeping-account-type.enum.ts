/**
 * What an account of the books holds: the balance sheet accounts hold assets, liabilities and equity, the accounts of
 * the income statement revenue and expenses, which closing a fiscal year carries into equity.
 */
export enum BookkeepingAccountType {
    /**
     * What the company owns, such as its bank account or its receivables. Increased by a debit.
     */
    ASSET = 'ASSET',
    /**
     * What the company owes, such as its payables or the VAT it collected. Increased by a credit.
     */
    LIABILITY = 'LIABILITY',
    /**
     * What belongs to the owners, such as the share capital and the results carried forward. Increased by a credit.
     */
    EQUITY = 'EQUITY',
    /**
     * What the company earns, such as its sales. Increased by a credit, and closed into equity at the end of a fiscal
     * year.
     */
    REVENUE = 'REVENUE',
    /**
     * What the company spends, such as rent or wages. Increased by a debit, and closed into equity at the end of a
     * fiscal year.
     */
    EXPENSE = 'EXPENSE'
}