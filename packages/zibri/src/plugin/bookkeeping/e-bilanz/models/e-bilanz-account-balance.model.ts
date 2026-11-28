import { type BigNumber } from '../../../../utilities/number.utilities';
import { type BookkeepingAccount } from '../../models/bookkeeping-account.model';

/**
 * What an account holds in a fiscal year, as an E-Bilanz reads it: the debits and credits of the year without its
 * closing entry, and those carrying its balances in among them, of its opening entry and of the entries against a
 * carry-forward account.
 */
export type EBilanzAccountBalance = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly account: BookkeepingAccount,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly debit: BigNumber,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly credit: BigNumber,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly openingDebit: BigNumber,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly openingCredit: BigNumber
};
