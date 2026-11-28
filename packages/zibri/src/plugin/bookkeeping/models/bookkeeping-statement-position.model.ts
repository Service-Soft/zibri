import { type BookkeepingStatementPositionModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';
import { BookkeepingAccountAmount } from './bookkeeping-account-amount.model';

/**
 * A position of a statement with its amount, such as `assets.B.IV` with the bank accounts.
 */
export class BookkeepingStatementPosition implements Omit<BookkeepingStatementPositionModel, 'amount' | 'previousAmount' | 'accounts'> {
    /**
     * The id of the position, such as `assets.B.IV`.
     */
    @Property.string()
    id!: string;

    /**
     * The id of the position it is below, or null for a position at the top.
     */
    @Property.string({ required: false })
    parentId!: string | null;

    /**
     * How deep it is below the top, 0 for a position at the top.
     */
    @Property.number({ format: 'integer', min: 0 })
    depth!: number;

    /**
     * The label of the position, in the locale of the request.
     */
    @Property.string()
    label!: string;

    /**
     * What the accounts of the position and the positions below it add up to. A balance on the side the statement
     * counts the position by adds, the other side subtracts.
     */
    @Property.number({ format: 'bignumber' })
    amount!: BigNumber;

    /**
     * The amount of the position in the fiscal year before, § 265 (2) HGB, or null for a statement without one, such
     * as of the first fiscal year of the books.
     */
    @Property.number({ format: 'bignumber', required: false })
    previousAmount!: BigNumber | null;

    /**
     * The accounts reported in the position, or in the positions of the full statement a shortened position adds up.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingAccountAmount } })
    accounts!: BookkeepingAccountAmount[];
}