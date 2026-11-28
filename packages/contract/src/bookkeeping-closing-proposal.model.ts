import { type NewJournalEntryModel } from './new-journal-entry.model';

/**
 * An entry a conformance proposes to post before a fiscal year is closed, such as the legal reserve of a company, as
 * `GET /bookkeeping/fiscal-years/:id/closing-proposals` answers it.
 */
export type BookkeepingClosingProposalModel = {
    /**
     * The name of the conformance proposing it.
     */
    conformance: string,
    /**
     * The entry, as `POST /bookkeeping/entries` takes it.
     */
    entry: NewJournalEntryModel
};
