import { type FiscalYearModel } from './fiscal-year.model';
import { type JournalEntryDetailsModel } from './journal-entry-details.model';

/**
 * What reopening a fiscal year posted, as `POST /bookkeeping/fiscal-years/:id/reopening` answers it.
 */
export type FiscalYearReopeningResultModel = {
    /**
     * The fiscal year, open again.
     */
    fiscalYear: FiscalYearModel,
    /**
     * The fiscal year after it, whose opening balances were reversed, or null when there is none.
     */
    nextFiscalYear: FiscalYearModel | null,
    /**
     * The reversal of the entry that closed the year, or null for a closing without one.
     */
    closingReversal: JournalEntryDetailsModel | null,
    /**
     * The reversal of the entry of the opening balances of the next fiscal year, or null for none.
     */
    openingReversal: JournalEntryDetailsModel | null
};
