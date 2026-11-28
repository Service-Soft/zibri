import { Property } from '../../../entity/decorators/property.decorator';
import { FiscalYear } from './fiscal-year.model';
import { JournalEntryDetails } from './journal-entry-details.model';

/**
 * What reopening a fiscal year posted: the fiscal year open again, the one after it, and the reversals of the entry
 * that closed it and of the opening balances of the next.
 */
// checked against FiscalYearReopeningResultModel of zibri-contract as json, as FiscalYearClosingResult is
export class FiscalYearReopeningResult {
    /**
     * The fiscal year, open again.
     */
    @Property.object({ cls: () => FiscalYear })
    fiscalYear!: FiscalYear;

    /**
     * The fiscal year after it, whose opening balances were reversed, or null when there is none.
     */
    @Property.object({ cls: () => FiscalYear, required: false })
    nextFiscalYear!: FiscalYear | null;

    /**
     * The reversal of the entry that closed the year, or null for a closing without one.
     */
    @Property.object({ cls: () => JournalEntryDetails, required: false })
    closingReversal!: JournalEntryDetails | null;

    /**
     * The reversal of the entry of the opening balances of the next fiscal year, or null for none.
     */
    @Property.object({ cls: () => JournalEntryDetails, required: false })
    openingReversal!: JournalEntryDetails | null;
}
