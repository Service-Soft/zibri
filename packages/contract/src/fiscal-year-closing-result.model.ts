import { type FiscalYearModel } from './fiscal-year.model';
import { type JournalEntryDetailsModel } from './journal-entry-details.model';

/**
 * What closing a fiscal year posted, as `POST /bookkeeping/fiscal-years/:id/closing` answers it.
 */
export type FiscalYearClosingResultModel = {
    /**
     * The fiscal year, closed.
     */
    fiscalYear: FiscalYearModel,
    /**
     * The fiscal year after it, which the opening balances are posted into, created when it was missing.
     */
    nextFiscalYear: FiscalYearModel,
    /**
     * The entry carrying the revenue and the expenses of the year into the result account, or null for a year
     * without either.
     */
    closingEntry: JournalEntryDetailsModel | null,
    /**
     * The entry of the opening balances of the balance sheet accounts in the next fiscal year, or null when every
     * one of them is zero.
     */
    openingEntry: JournalEntryDetailsModel | null
};
