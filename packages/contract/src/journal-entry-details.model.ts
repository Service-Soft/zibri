import { type JournalEntryLineModel } from './journal-entry-line.model';
import { type JournalEntryModel } from './journal-entry.model';

/**
 * A posted journal entry with its lines, as the routes of `/bookkeeping/entries` answer it.
 */
export type JournalEntryDetailsModel = {
    /**
     * The entry.
     */
    entry: JournalEntryModel,
    /**
     * Its lines, in the order they were posted.
     */
    lines: JournalEntryLineModel[],
    /**
     * The id of the entry reversing this one, or null while none does.
     */
    reversedByEntryId: string | null
};
