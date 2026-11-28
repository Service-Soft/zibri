import { type BookkeepingTrialBalanceRowModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BookkeepingAccount } from './bookkeeping-account.model';

/**
 * A row of a trial balance: what the lines of a fiscal year add up to on one account.
 */
export class BookkeepingTrialBalanceRow implements Omit<BookkeepingTrialBalanceRowModel, 'account' | 'debit' | 'credit' | 'balance'> {
    /**
     * The account.
     */
    @Property.object({ cls: () => BookkeepingAccount })
    account!: BookkeepingAccount;

    /**
     * The sum of its debits.
     */
    @Property.number({ format: 'bignumber' })
    debit!: BigNumber;

    /**
     * The sum of its credits.
     */
    @Property.number({ format: 'bignumber' })
    credit!: BigNumber;

    /**
     * Its debits less its credits.
     */
    @Property.number({ format: 'bignumber' })
    balance!: BigNumber;
}
