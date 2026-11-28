import { type BigNumber } from '../../../../utilities/number.utilities';
import { type BookkeepingAccount } from '../../models/bookkeeping-account.model';

/**
 * A line of the closing entry of a fiscal year carrying its result into equity, as an E-Bilanz reads it.
 */
export type EBilanzResultLine = {
    /**
     * The account the line carries the result to.
     */
    readonly account: BookkeepingAccount,
    /**
     * The part of the result the line carries, its credit less its debit: above 0 for a profit.
     */
    readonly amount: BigNumber
};
