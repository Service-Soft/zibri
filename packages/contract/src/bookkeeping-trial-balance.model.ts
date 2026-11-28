import { type BookkeepingTrialBalanceRowModel } from './bookkeeping-trial-balance-row.model';

/**
 * The sums and balances of every account booked on in a fiscal year up to a day, as
 * `GET /bookkeeping/reports/trial-balance` answers them. Amounts are decimal strings.
 */
export type BookkeepingTrialBalanceModel = {
    /**
     * The id of the fiscal year.
     */
    fiscalYearId: string,
    /**
     * The first day of the fiscal year.
     */
    start: Date,
    /**
     * The last day whose entries count.
     */
    until: Date,
    /**
     * A row per account booked on, by number.
     */
    rows: BookkeepingTrialBalanceRowModel[],
    /**
     * The sum of the debits of every row.
     */
    debit: string,
    /**
     * The sum of the credits of every row, the same as `debit`.
     */
    credit: string,
    /**
     * The sum of the balances on the debit side.
     */
    debitBalances: string,
    /**
     * The sum of the balances on the credit side, as a positive amount, the same as `debitBalances`.
     */
    creditBalances: string
};