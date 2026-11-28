import { type BookedJournalEntryLine } from './booked-journal-entry-line.model';
import { type JournalEntryLine } from './journal-entry-line.model';

/**
 * A line of the entry closing a fiscal year: a line as it is booked, and its role.
 */
export type ClosingJournalEntryLine = BookedJournalEntryLine & Pick<JournalEntryLine, 'role'>;