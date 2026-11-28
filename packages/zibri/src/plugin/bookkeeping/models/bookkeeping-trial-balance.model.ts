import { type BookkeepingTrialBalanceModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BookkeepingTrialBalanceRow } from './bookkeeping-trial-balance-row.model';

/**
 * The sums and balances of every account booked on in a fiscal year up to a day, as `resolveTrialBalance` of the
 * report service answers them. The entry closing the year is left out, so the revenue and expense accounts keep the
 * balances it carries into equity.
 */
export class BookkeepingTrialBalance
    implements Omit<BookkeepingTrialBalanceModel, 'rows' | 'debit' | 'credit' | 'debitBalances' | 'creditBalances'> {
    /**
     * The id of the fiscal year.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The first day of the fiscal year.
     */
    @Property.date()
    start!: Date;

    /**
     * The last day whose entries count.
     */
    @Property.date()
    until!: Date;

    /**
     * A row per account booked on, by number.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingTrialBalanceRow } })
    rows!: BookkeepingTrialBalanceRow[];

    /**
     * The sum of the debits of every row.
     */
    @Property.number({ format: 'bignumber' })
    debit!: BigNumber;

    /**
     * The sum of the credits of every row, the same as `debit`.
     */
    @Property.number({ format: 'bignumber' })
    credit!: BigNumber;

    /**
     * The sum of the balances on the debit side.
     */
    @Property.number({ format: 'bignumber' })
    debitBalances!: BigNumber;

    /**
     * The sum of the balances on the credit side, as a positive amount, the same as `debitBalances`.
     */
    @Property.number({ format: 'bignumber' })
    creditBalances!: BigNumber;
}
