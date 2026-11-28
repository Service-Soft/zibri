/**
 * A line of a journal entry to post: an amount on the debit or the credit side of an account, as a decimal string
 * above zero with at most the minor units of the currency of the books, such as `'119.00'`.
 */
export type NewJournalEntryLineModel = {
    /**
     * The id of an open account.
     */
    accountId: string,
    /**
     * The amount on the debit side, or null for a line on the credit side.
     */
    debit?: string | null,
    /**
     * The amount on the credit side, or null for a line on the debit side.
     */
    credit?: string | null
};