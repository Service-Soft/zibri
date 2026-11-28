/**
 * Which matches `findMatches` answers. Every match of the active tenant by default.
 */
export type BankMatchFilter = {
    /**
     * Only the matches of this transaction.
     */
    transactionId?: string,
    /**
     * Only the matches of this invoice.
     */
    invoiceId?: string
};