import { type BookkeepingObligationModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * Something a conformance asks of a fiscal year once it is closed, such as filing its E-Bilanz, with its deadline.
 */
export class BookkeepingObligation implements Omit<BookkeepingObligationModel, 'dueOn' | 'fulfilledAt'> {
    /**
     * The name of the conformance asking for it.
     */
    @Property.string()
    conformance!: string;

    /**
     * What it is, such as `e-bilanz`.
     */
    @Property.string()
    name!: string;

    /**
     * What it asks.
     */
    @Property.string()
    description!: string;

    /**
     * The last day it can be done on, at midnight UTC.
     */
    @Property.date()
    dueOn!: Date;

    /**
     * When it was done, or null while it is not.
     */
    @Property.date({ required: false })
    fulfilledAt!: Date | null;
}