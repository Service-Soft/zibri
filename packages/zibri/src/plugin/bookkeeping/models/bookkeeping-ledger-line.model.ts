import { type BookkeepingLedgerLineModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../utilities/number.utilities';

/**
 * A line of the ledger of an account: what one entry booked on it, and the balance after it.
 */
export class BookkeepingLedgerLine implements Omit<BookkeepingLedgerLineModel, 'debit' | 'credit' | 'balance'> {
    /**
     * The id of the entry.
     */
    @Property.string({ format: 'uuid' })
    entryId!: string;

    /**
     * The id of the fiscal year of the entry.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The number of the entry in its fiscal year.
     */
    @Property.number({ format: 'integer', min: 1 })
    sequence!: number;

    /**
     * The day the entry is booked on.
     */
    @Property.date()
    postingDate!: Date;

    /**
     * The day of the document the entry is booked from.
     */
    @Property.date()
    documentDate!: Date;

    /**
     * The number of the document, or null for none.
     */
    @Property.string({ required: false })
    documentReference!: string | null;

    /**
     * What was booked.
     */
    @Property.string()
    text!: string;

    /**
     * The amount on the debit side, or null for a line on the credit side.
     */
    @Property.number({ format: 'bignumber', required: false })
    debit!: BigNumber | null;

    /**
     * The amount on the credit side, or null for a line on the debit side.
     */
    @Property.number({ format: 'bignumber', required: false })
    credit!: BigNumber | null;

    /**
     * The debits less the credits of the account in the fiscal year of the entry, up to and with this line.
     */
    @Property.number({ format: 'bignumber' })
    balance!: BigNumber;
}