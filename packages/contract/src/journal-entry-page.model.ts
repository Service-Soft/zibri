import { type JournalEntryDetailsModel } from './journal-entry-details.model';
import { type PaginationResult } from './pagination-result.model';

/**
 * A page of the journal entries, as `GET /bookkeeping/entries` answers it: a `PaginationResult` of the entries with
 * their lines, and what the lines of every matching entry add up to, not only of those of the page. The totals are
 * decimal strings, such as `'714'`.
 */
export type JournalEntryPageModel = PaginationResult<JournalEntryDetailsModel> & {
    /**
     * The debits of the lines of every matching entry, or of their lines on the account the query names.
     */
    debit: string,
    /**
     * The credits of the lines of every matching entry, or of their lines on the account the query names.
     */
    credit: string
};
