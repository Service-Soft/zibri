import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BookkeepingAccountBalance } from './bookkeeping-account-balance.model';
import { type BookkeepingSettings } from './bookkeeping-settings.model';
import { type FiscalYear } from './fiscal-year.model';

/**
 * A fiscal year about to be closed, as the conformance services are handed it.
 */
export type BookkeepingClosing = {
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
     * What the lines of the fiscal year add up to on each account booked on, by the number of the account. Before the
     * revenue and the expenses are carried into equity.
     */
    balances: BookkeepingAccountBalance[],
    /**
     * The transaction the fiscal year is closed in, or undefined while proposals are resolved, outside of one.
     */
    transaction: Transaction | undefined
};
