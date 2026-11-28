import { type BookkeepingLedgerReportModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BookkeepingAccount } from './bookkeeping-account.model';
import { BookkeepingLedgerLine } from './bookkeeping-ledger-line.model';

/**
 * What was booked on one account on the days of a range, as `resolveLedger` of the report service answers it. A
 * balance is the debits less the credits, and runs within each fiscal year, which opens with the balances the one
 * before closed with.
 */
export class BookkeepingLedgerReport
    implements Omit<BookkeepingLedgerReportModel, 'account' | 'lines' | 'openingBalance' | 'debit' | 'credit' | 'closingBalance'> {
    /**
     * The account.
     */
    @Property.object({ cls: () => BookkeepingAccount })
    account!: BookkeepingAccount;

    /**
     * The first day of the range.
     */
    @Property.date()
    from!: Date;

    /**
     * The last day of the range.
     */
    @Property.date()
    until!: Date;

    /**
     * The balance of the account in the fiscal year of `from` before it.
     */
    @Property.number({ format: 'bignumber' })
    openingBalance!: BigNumber;

    /**
     * The lines booked on the account, by posting day and sequence.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingLedgerLine } })
    lines!: BookkeepingLedgerLine[];

    /**
     * The sum of the debits of the lines.
     */
    @Property.number({ format: 'bignumber' })
    debit!: BigNumber;

    /**
     * The sum of the credits of the lines.
     */
    @Property.number({ format: 'bignumber' })
    credit!: BigNumber;

    /**
     * The balance after the last line, or the opening balance without lines.
     */
    @Property.number({ format: 'bignumber' })
    closingBalance!: BigNumber;
}
