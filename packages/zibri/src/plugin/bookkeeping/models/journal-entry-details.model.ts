import { Property } from '../../../entity/decorators/property.decorator';
import { JournalEntryLine } from './journal-entry-line.model';
import { JournalEntry } from './journal-entry.model';

/**
 * A posted journal entry with its lines, as posting, reversing and reading one answer it.
 */
export class JournalEntryDetails {
    /**
     * The entry.
     */
    @Property.object({ cls: () => JournalEntry })
    entry!: JournalEntry;

    /**
     * Its lines, in the order they were posted.
     */
    @Property.array({ items: { type: 'object', cls: () => JournalEntryLine } })
    lines!: JournalEntryLine[];

    /**
     * The id of the entry reversing this one, or null while none does. Read from the `reversesEntryId` of the
     * reversal, as an entry is never changed once it is posted.
     */
    @Property.string({ format: 'uuid', required: false })
    reversedByEntryId!: string | null;
}
