import { type BookkeepingAccountModel } from './bookkeeping-account.model';
import { type BookkeepingLedgerLineModel } from './bookkeeping-ledger-line.model';

/**
 * What was booked on one account on the days of a range, as `GET /bookkeeping/reports/ledger` answers it. Amounts are
 * decimal strings, and a balance is the debits less the credits.
 */
export type BookkeepingLedgerReportModel = {
    /**
     * The account.
     */
    account: BookkeepingAccountModel,
    /**
     * The first day of the range.
     */
    from: Date,
    /**
     * The last day of the range.
     */
    until: Date,
    /**
     * The balance of the account in the fiscal year of `from` before it.
     */
    openingBalance: string,
    /**
     * The lines booked on the account, by posting day and sequence.
     */
    lines: BookkeepingLedgerLineModel[],
    /**
     * The sum of the debits of the lines.
     */
    debit: string,
    /**
     * The sum of the credits of the lines.
     */
    credit: string,
    /**
     * The balance after the last line, in the fiscal year of `until`.
     */
    closingBalance: string
};
