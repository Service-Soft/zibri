import { type BookkeepingStatementModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BookkeepingAccountAmount } from './bookkeeping-account-amount.model';
import { BookkeepingStatementPosition } from './bookkeeping-statement-position.model';
import { BookkeepingStatementType } from './bookkeeping-statement-type.enum';

/**
 * The balance sheet or the income statement of a fiscal year in one form, as `resolveBalanceSheet` and
 * `resolveIncomeStatement` of the report service answer it.
 */
export class BookkeepingStatement implements Omit<BookkeepingStatementModel, 'positions' | 'unmapped' | 'result'> {
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
     * The id of the fiscal year before, whose figures each position states as its `previousAmount`, or null for the
     * first fiscal year of the books.
     */
    @Property.string({ format: 'uuid', required: false })
    previousFiscalYearId!: string | null;

    /**
     * The last day of the fiscal year before, or null for the first fiscal year of the books.
     */
    @Property.date({ required: false })
    previousEnd!: Date | null;

    /**
     * The last day of the fiscal year, the balance sheet date.
     */
    @Property.date()
    end!: Date;

    /**
     * Whether the fiscal year is closed, which makes the statement final.
     */
    @Property.boolean()
    closed!: boolean;

    /**
     * What the statement states.
     */
    @Property.string({ enum: BookkeepingStatementType })
    type!: BookkeepingStatementType;

    /**
     * The id of the form it is in, such as `hgb.balance-sheet.small`.
     */
    @Property.string()
    form!: string;

    /**
     * The label of the form, in the locale of the request.
     */
    @Property.string()
    label!: string;

    /**
     * Every position of the form, in its order, each after the position it is below.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingStatementPosition } })
    positions!: BookkeepingStatementPosition[];

    /**
     * The accounts of the statement with a balance and no position in it, which none of the positions holds.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingAccountAmount } })
    unmapped!: BookkeepingAccountAmount[];

    /**
     * The result of the fiscal year, its revenue less its expenses, positive for a profit. On a balance sheet, part
     * of the equity position its form names for it, whether or not it is posted.
     */
    @Property.number({ format: 'bignumber' })
    result!: BigNumber;
}
