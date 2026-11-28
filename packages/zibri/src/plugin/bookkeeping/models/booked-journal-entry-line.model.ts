import { type NewJournalEntryLine } from './new-journal-entry-line.model';

/**
 * A line of a journal entry as it is booked: an account, and the amounts on its debit and its credit side.
 */
export type BookedJournalEntryLine = Pick<NewJournalEntryLine, 'accountId' | 'debit' | 'credit'>;