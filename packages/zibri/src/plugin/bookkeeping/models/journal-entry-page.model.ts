import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { JournalEntryDetails } from './journal-entry-details.model';

/**
 * A page of the journal entries, as `GET /entries` and `findEntries` answer it: the entries of the page with their
 * lines, how many entries match, and what the lines of every matching entry add up to.
 */
export class JournalEntryPage {
    /**
     * The entries of the page, with their lines.
     */
    @Property.array({ items: { type: 'object', cls: () => JournalEntryDetails } })
    items!: JournalEntryDetails[];

    /**
     * How many entries match, on all pages together.
     */
    @Property.number({ format: 'integer' })
    totalAmount!: number;

    /**
     * The debits of the lines of every matching entry, or of their lines on the account the filter names.
     */
    @Property.number({ format: 'bignumber' })
    debit!: BigNumber;

    /**
     * The credits of the lines of every matching entry, or of their lines on the account the filter names.
     */
    @Property.number({ format: 'bignumber' })
    credit!: BigNumber;
}
