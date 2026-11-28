import { type ArchivedFileModel } from './archived-file.model';
import { type JournalEntryLineRole } from './journal-entry-line-role.enum';

/**
 * A line of a posted journal entry: an amount on the debit or the credit side of an account. Amounts are decimal
 * strings, such as `'119.00'`, and above zero.
 */
export type JournalEntryLineModel = {
    /**
     * The id of the line.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string,
    /**
     * The place of the line in the chain of the lines of its tenant.
     */
    chainSequence: number,
    /**
     * The hash linking the line to the one before it in its chain.
     */
    chainHash: string,
    /**
     * When the retention of the line ends, the same as its entry's.
     */
    retainUntil: Date,
    /**
     * The files of the line, always none.
     */
    archivedFiles: ArchivedFileModel[],
    /**
     * The id of the entry the line belongs to.
     */
    entryId: string,
    /**
     * The id of the fiscal year of the entry.
     */
    fiscalYearId: string,
    /**
     * The id of the account booked on.
     */
    accountId: string,
    /**
     * The amount on the debit side, or null for a line on the credit side.
     */
    debit?: string | null,
    /**
     * The amount on the credit side, or null for a line on the debit side.
     */
    credit?: string | null,
    /**
     * What the line does beyond its amount, such as `result` for the line of the closing entry carrying the result of
     * the year into equity, or null for an ordinary line.
     */
    role?: JournalEntryLineRole | null
};