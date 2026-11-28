import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BankTransaction } from './bank-transaction.model';

/**
 * A booked transaction with what of it is left to match, as `GET /transactions` answers it.
 */
export class BankTransactionDetails {
    /**
     * The transaction.
     */
    @Property.object({ cls: () => BankTransaction })
    transaction!: BankTransaction;

    /**
     * What of the transaction is not matched yet, without its sign: its amount less its confirmed matches, a reversal
     * opening again what it reverses. Zero for a transaction matched in full.
     */
    @Property.number({ format: 'bignumber' })
    openAmount!: BigNumber;
}
