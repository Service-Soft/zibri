import { type BookkeepingVerificationModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingVerificationProblem } from './bookkeeping-verification-problem.model';

/**
 * What checking the books of a tenant found: whether the chains of its entries and lines hold, and whether every
 * entry balances.
 */
export class BookkeepingVerification implements BookkeepingVerificationModel {
    /**
     * Whether both chains hold, and every entry has at least two lines whose debits add up to their credits.
     */
    @Property.boolean()
    intact!: boolean;

    /**
     * The place of the newest entry in the chain of the entries, 0 for no entries, or null for a chain that is
     * broken. Keep it and the hash outside the data source: a chain alone cannot tell that its newest rows were
     * removed.
     */
    @Property.number({ format: 'integer', required: false })
    newestEntrySequence!: number | null;

    /**
     * The hash of the newest entry, or null for a chain that is broken.
     */
    @Property.string({ required: false })
    newestEntryHash!: string | null;

    /**
     * The place of the newest line in the chain of the lines, 0 for no lines, or null for a chain that is broken.
     */
    @Property.number({ format: 'integer', required: false })
    newestLineSequence!: number | null;

    /**
     * The hash of the newest line, or null for a chain that is broken.
     */
    @Property.string({ required: false })
    newestLineHash!: string | null;

    /**
     * What does not hold: the first entry and the first line where a chain breaks, and every entry that does not
     * balance. Empty for intact books.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingVerificationProblem } })
    problems!: BookkeepingVerificationProblem[];
}