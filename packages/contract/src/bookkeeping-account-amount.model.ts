/**
 * What one account adds to a report, such as to a position of a statement. Its amount is a decimal string, such as
 * `'119.00'`.
 */
export type BookkeepingAccountAmountModel = {
    /**
     * The id of the account.
     */
    accountId: string,
    /**
     * The number of the account, such as `1200`.
     */
    number: string,
    /**
     * The name of the account, such as `Bank`.
     */
    name: string,
    /**
     * The amount: in a position, what it adds to the position; of an account without a position, its balance on the
     * side its type increases by, a debit for an asset or an expense, a credit for every other.
     */
    amount: string
};