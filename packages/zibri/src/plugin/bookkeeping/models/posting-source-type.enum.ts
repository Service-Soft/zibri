/**
 * What created an entry the posting service posts, as the `sourceType` of the entry.
 */
export enum PostingSourceType {
    /**
     * An invoice of the invoicing plugin, posted once it is issued.
     */
    INVOICE = 'invoicing.invoice',
    /**
     * A credit note of the invoicing plugin, posted once it is issued.
     */
    CREDIT_NOTE = 'invoicing.credit-note',
    /**
     * An expense, posted once it is recorded.
     */
    EXPENSE = 'bookkeeping.expense',
    /**
     * A match of a bank transaction, posted once it is confirmed, and a match reversing another.
     */
    BANK_MATCH = 'bank.match'
}
