import { type JournalEntryDetailsModel } from './journal-entry-details.model';

/**
 * The entries posted on the days of a range, as `GET /bookkeeping/reports/journal` answers them. Amounts are decimal
 * strings.
 */
export type BookkeepingJournalReportModel = {
    /**
     * The first day of the range.
     */
    from: Date,
    /**
     * The last day of the range.
     */
    until: Date,
    /**
     * The entries with their lines, by posting day and sequence.
     */
    entries: JournalEntryDetailsModel[],
    /**
     * The sum of the debits of the entries.
     */
    debit: string,
    /**
     * The sum of the credits of the entries, the same as `debit`.
     */
    credit: string
};
