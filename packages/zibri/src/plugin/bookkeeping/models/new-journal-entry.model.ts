import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';
import { NewJournalEntryLine } from './new-journal-entry-line.model';

/**
 * A journal entry to post, as `POST /entries` of the `BookkeepingController` takes it, and as a conformance proposes
 * one at closing.
 */
export class NewJournalEntry {
    /**
     * The day of the document the entry is booked from, such as the date of an invoice, at midnight UTC.
     */
    @Property.date()
    documentDate!: Date;

    /**
     * The day the entry is booked on, at midnight UTC, which needs to fall into an open fiscal year.
     */
    @Property.date()
    postingDate!: Date;

    /**
     * The number of the document, such as the number of an invoice, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.DOCUMENT_REFERENCE_MAX_LENGTH })
    documentReference?: string | null;

    /**
     * What was booked, such as `Rent November`.
     */
    @Property.string({ maxLength: BookkeepingLimits.TEXT_MAX_LENGTH })
    text!: string;

    /**
     * At least two lines, whose debits add up to their credits.
     */
    @Property.array({ items: { type: 'object', cls: () => NewJournalEntryLine } })
    lines!: NewJournalEntryLine[];
}
