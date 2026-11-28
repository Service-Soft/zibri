/**
 * A line of the ledger of an account: what one entry booked on it, and the balance after it. Amounts are decimal
 * strings.
 */
export type BookkeepingLedgerLineModel = {
    /**
     * The id of the entry.
     */
    entryId: string,
    /**
     * The id of the fiscal year of the entry.
     */
    fiscalYearId: string,
    /**
     * The number of the entry in its fiscal year.
     */
    sequence: number,
    /**
     * The day the entry is booked on.
     */
    postingDate: Date,
    /**
     * The day of the document the entry is booked from.
     */
    documentDate: Date,
    /**
     * The number of the document, or null for none.
     */
    documentReference: string | null,
    /**
     * What was booked.
     */
    text: string,
    /**
     * The amount on the debit side, or null for a line on the credit side.
     */
    debit: string | null,
    /**
     * The amount on the credit side, or null for a line on the debit side.
     */
    credit: string | null,
    /**
     * The debits less the credits of the account in the fiscal year of the entry, up to and with this line.
     */
    balance: string
};