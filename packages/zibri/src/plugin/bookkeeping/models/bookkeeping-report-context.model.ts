import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BookkeepingSettings } from './bookkeeping-settings.model';
import { type FiscalYear } from './fiscal-year.model';

/**
 * A fiscal year a report or posting rules are of, as the conformance services are handed it.
 */
export type BookkeepingReportContext = {
    /**
     * The settings of the books whose fiscal year it is.
     */
    settings: BookkeepingSettings,
    /**
     * The fiscal year.
     */
    fiscalYear: FiscalYear,
    /**
     * The legal form the tenant has at the end of the fiscal year, or undefined for a tenant of none then.
     */
    legalForm: string | undefined,
    /**
     * The transaction whatever is read for the report is read in: the one of the closing while its statements are
     * archived, which sees what it wrote before, or undefined outside of one.
     */
    transaction?: Transaction
};
