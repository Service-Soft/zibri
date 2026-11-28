import { type BookkeepingAccountAmountModel } from './bookkeeping-account-amount.model';

/**
 * The revenue of a calendar year, such as to watch the turnover limits of a small business exempt from VAT, as
 * `GET /bookkeeping/reports/revenue` answers it. Amounts are decimal strings.
 */
export type BookkeepingRevenueReportModel = {
    /**
     * The calendar year, such as `2026`.
     */
    year: number,
    /**
     * Its first day.
     */
    from: Date,
    /**
     * Its last day.
     */
    until: Date,
    /**
     * The credits less the debits of each revenue account booked on in it, by number.
     */
    accounts: BookkeepingAccountAmountModel[],
    /**
     * The sum of the amounts of the accounts.
     */
    total: string
};