import { type NewJournalEntry } from './new-journal-entry.model';

/**
 * What `post` of the journal service takes: the entry, who posts it and what created it.
 */
export type JournalEntryPosting = NewJournalEntry & {
    /**
     * The id of the user who posts the entry. None by default.
     */
    createdBy?: string | null,
    /**
     * What kind of thing created the entry, such as `invoice`. None by default, for an entry posted by hand.
     */
    sourceType?: string | null,
    /**
     * The id of what created the entry. None by default.
     */
    sourceId?: string | null
};
