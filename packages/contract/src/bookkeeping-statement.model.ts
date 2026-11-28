import { type BookkeepingAccountAmountModel } from './bookkeeping-account-amount.model';
import { type BookkeepingStatementPositionModel } from './bookkeeping-statement-position.model';
import { type BookkeepingStatementType } from './bookkeeping-statement-type.enum';

/**
 * The balance sheet or the income statement of a fiscal year in one form, as `GET /bookkeeping/reports/balance-sheet`
 * and `GET /bookkeeping/reports/income-statement` answer it. Amounts are decimal strings.
 */
export type BookkeepingStatementModel = {
    /**
     * The id of the fiscal year.
     */
    fiscalYearId: string,
    /**
     * The first day of the fiscal year.
     */
    start: Date,
    /**
     * The last day of the fiscal year, the balance sheet date.
     */
    end: Date,
    /**
     * The id of the fiscal year before, whose figures each position states as its `previousAmount`, or null for the
     * first fiscal year of the books.
     */
    previousFiscalYearId: string | null,
    /**
     * The last day of the fiscal year before, or null for the first fiscal year of the books.
     */
    previousEnd: Date | null,
    /**
     * Whether the fiscal year is closed, which makes the statement final, answered as it was archived at its closing.
     */
    closed: boolean,
    /**
     * What the statement states.
     */
    type: BookkeepingStatementType,
    /**
     * The id of the form it is in, such as `hgb.balance-sheet.small`.
     */
    form: string,
    /**
     * The label of the form, in the locale of the request.
     */
    label: string,
    /**
     * Every position of the form, in its order, each after the position it is below.
     */
    positions: BookkeepingStatementPositionModel[],
    /**
     * The accounts of the statement with a balance and no position in it, which none of the positions holds.
     */
    unmapped: BookkeepingAccountAmountModel[],
    /**
     * The result of the fiscal year, its revenue less its expenses, positive for a profit. On a balance sheet, part
     * of the equity position its form names for it, whether or not it is posted.
     */
    result: string
};
