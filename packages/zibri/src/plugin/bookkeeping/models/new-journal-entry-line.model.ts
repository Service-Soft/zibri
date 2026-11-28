import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';

/**
 * A line of a journal entry to post: an amount above 0 on the debit or the credit side of an account, with at most
 * the minor units of the currency of the books.
 */
export class NewJournalEntryLine {
    /**
     * The id of an open account.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The amount on the debit side, or null for a line on the credit side.
     */
    @Property.number({ format: 'bignumber', required: false })
    debit?: BigNumber | null;

    /**
     * The amount on the credit side, or null for a line on the debit side.
     */
    @Property.number({ format: 'bignumber', required: false })
    credit?: BigNumber | null;
}