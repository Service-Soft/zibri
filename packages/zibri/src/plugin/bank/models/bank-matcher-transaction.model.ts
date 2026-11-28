import { type BigNumber } from '../../../utilities/number.utilities';
import { type BankTransaction } from './bank-transaction.model';

/**
 * A transaction a matcher suggests matches for, with what of it is left to match.
 */
export type BankMatcherTransaction = {
    /**
     * The transaction, of money received or paid.
     */
    transaction: BankTransaction,
    /**
     * What of it is neither matched nor spoken for by a pending suggestion, above zero, whichever its direction.
     */
    open: BigNumber
};
