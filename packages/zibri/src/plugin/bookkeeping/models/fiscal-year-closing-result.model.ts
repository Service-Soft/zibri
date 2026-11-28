import { Property } from '../../../entity/decorators/property.decorator';
import { FiscalYear } from './fiscal-year.model';
import { JournalEntryDetails } from './journal-entry-details.model';

/**
 * What closing a fiscal year posted, as `closeFiscalYear` of the journal service answers it.
 */
export class FiscalYearClosingResult {
    /**
     * The fiscal year, closed.
     */
    @Property.object({ cls: () => FiscalYear })
    fiscalYear!: FiscalYear;

    /**
     * The fiscal year after it, which the opening balances are posted into, created when it was missing.
     */
    @Property.object({ cls: () => FiscalYear })
    nextFiscalYear!: FiscalYear;

    /**
     * The entry carrying the revenue and the expenses of the year into the result account, or null for a year
     * without either.
     */
    @Property.object({ cls: () => JournalEntryDetails, required: false })
    closingEntry!: JournalEntryDetails | null;

    /**
     * The entry of the opening balances of the balance sheet accounts in the next fiscal year, or null when every one
     * of them is zero.
     */
    @Property.object({ cls: () => JournalEntryDetails, required: false })
    openingEntry!: JournalEntryDetails | null;
}
