/**
 * How to reverse a journal entry, as `POST /bookkeeping/entries/:id/reversal` takes it.
 */
export type JournalEntryReversalModel = {
    /**
     * The day the reversal is booked on, which needs to fall into an open fiscal year of the company. Written as
     * `2026-11-30`.
     */
    postingDate: Date,
    /**
     * Why the entry is reversed, such as `Booked on the wrong account`.
     */
    text: string
};
