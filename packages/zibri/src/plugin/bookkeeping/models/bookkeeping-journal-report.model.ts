import { type BookkeepingJournalReportModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { JournalEntryDetails } from './journal-entry-details.model';

/**
 * The entries posted on the days of a range, as `resolveJournal` of the report service answers them.
 */
export class BookkeepingJournalReport implements Omit<BookkeepingJournalReportModel, 'entries' | 'debit' | 'credit'> {
    /**
     * The first day of the range.
     */
    @Property.date()
    from!: Date;

    /**
     * The last day of the range.
     */
    @Property.date()
    until!: Date;

    /**
     * The entries with their lines, by posting day and sequence.
     */
    @Property.array({ items: { type: 'object', cls: () => JournalEntryDetails } })
    entries!: JournalEntryDetails[];

    /**
     * The sum of the debits of the entries.
     */
    @Property.number({ format: 'bignumber' })
    debit!: BigNumber;

    /**
     * The sum of the credits of the entries, the same as `debit`.
     */
    @Property.number({ format: 'bignumber' })
    credit!: BigNumber;
}