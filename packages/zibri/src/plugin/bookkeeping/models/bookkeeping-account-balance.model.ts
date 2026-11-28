import { type BigNumber } from '../../../utilities/number.utilities';
import { type BookkeepingAccount } from './bookkeeping-account.model';

/**
 * What the lines of a fiscal year add up to on one account.
 */
export type BookkeepingAccountBalance = {
    /**
     * The account.
     */
    account: BookkeepingAccount,
    /**
     * The sum of its debits.
     */
    debit: BigNumber,
    /**
     * The sum of its credits.
     */
    credit: BigNumber
};