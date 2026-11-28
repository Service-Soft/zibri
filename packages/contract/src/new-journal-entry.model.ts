import { type NewJournalEntryLineModel } from './new-journal-entry-line.model';

/**
 * A journal entry to post, as `POST /bookkeeping/entries` takes it. Days are written as `2026-11-30`.
 */
export type NewJournalEntryModel = {
    /**
     * The day of the document the entry is booked from, such as the date of an invoice.
     */
    documentDate: Date,
    /**
     * The day the entry is booked on, which needs to fall into an open fiscal year.
     */
    postingDate: Date,
    /**
     * The number of the document, such as the number of an invoice, or null for none.
     */
    documentReference?: string | null,
    /**
     * What was booked, such as `Rent November`.
     */
    text: string,
    /**
     * At least two lines, whose debits add up to their credits.
     */
    lines: NewJournalEntryLineModel[]
};