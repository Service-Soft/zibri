import { type BookkeepingAccountAmountModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';

/**
 * What one account adds to a report, such as to a position of a statement.
 */
export class BookkeepingAccountAmount implements Omit<BookkeepingAccountAmountModel, 'amount'> {
    /**
     * The id of the account.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The number of the account, such as `1200`.
     */
    @Property.string()
    number!: string;

    /**
     * The name of the account, such as `Bank`.
     */
    @Property.string()
    name!: string;

    /**
     * The amount: in a position, what it adds to the position; of an account without a position, its balance on the
     * side its type increases by, a debit for an asset or an expense, a credit for every other.
     */
    @Property.number({ format: 'bignumber' })
    amount!: BigNumber;
}
