import { type ArchivedFileModel } from './archived-file.model';

/**
 * A posted entry of the journal of a tenant, as the routes of `/bookkeeping/entries` answer it beside its lines.
 * Its days are at midnight UTC.
 */
export type JournalEntryModel = {
    /**
     * The id of the entry.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string,
    /**
     * The place of the entry in the chain of the entries of its tenant.
     */
    chainSequence: number,
    /**
     * The hash linking the entry to the one before it in its chain.
     */
    chainHash: string,
    /**
     * When the retention of the entry ends, from which it may be deleted.
     */
    retainUntil: Date,
    /**
     * The files of the entry, always none.
     */
    archivedFiles: ArchivedFileModel[],
    /**
     * The id of the fiscal year its posting date falls into.
     */
    fiscalYearId: string,
    /**
     * The number of the entry in its fiscal year, counting from 1 without a gap.
     */
    sequence: number,
    /**
     * The day of the document the entry is booked from, such as the date of an invoice.
     */
    documentDate: Date,
    /**
     * The day the entry is booked on, which decides its fiscal year.
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
     * The id of the user who posted the entry, or null when no user did.
     */
    createdBy?: string | null,
    /**
     * The id of the entry this one reverses, or null for an entry that reverses none.
     */
    reversesEntryId?: string | null,
    /**
     * What kind of thing created the entry, such as `bookkeeping.opening` for the opening balances of a fiscal year,
     * or null for an entry posted by hand.
     */
    sourceType?: string | null,
    /**
     * The id of what created the entry, or null for an entry posted by hand.
     */
    sourceId?: string | null,
    /**
     * When the entry was posted.
     */
    postedAt: Date
};
