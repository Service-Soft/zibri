import { type JournalEntryReversal } from './journal-entry-reversal.model';

/**
 * What `reverse` of the journal service takes: the day and the text of the reversal, who posts it and what created it.
 */
export type JournalEntryReversalPosting = JournalEntryReversal & {
    /**
     * The id of the user who posts the reversal. None by default.
     */
    createdBy?: string | null,
    /**
     * What kind of thing created the reversal, such as `bank.match` for a match reversing another. None by default.
     */
    sourceType?: string | null,
    /**
     * The id of what created the reversal. None by default.
     */
    sourceId?: string | null
};
