import { type BookkeepingRevenueReportModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BookkeepingAccountAmount } from './bookkeeping-account-amount.model';

/**
 * The revenue of a calendar year, such as to watch the turnover limits of a small business exempt from VAT, as
 * `resolveRevenue` of the report service answers it.
 */
export class BookkeepingRevenueReport implements Omit<BookkeepingRevenueReportModel, 'accounts' | 'total'> {
    /**
     * The calendar year, such as `2026`.
     */
    @Property.number({ format: 'integer' })
    year!: number;

    /**
     * Its first day.
     */
    @Property.date()
    from!: Date;

    /**
     * Its last day.
     */
    @Property.date()
    until!: Date;

    /**
     * The credits less the debits of each revenue account booked on in it, by number. The entries closing a fiscal
     * year are left out.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingAccountAmount } })
    accounts!: BookkeepingAccountAmount[];

    /**
     * The sum of the amounts of the accounts.
     */
    @Property.number({ format: 'bignumber' })
    total!: BigNumber;
}
