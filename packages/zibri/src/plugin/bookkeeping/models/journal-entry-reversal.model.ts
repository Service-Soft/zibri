import { type JournalEntryReversalModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * How to reverse a journal entry, as `POST /entries/:id/reversal` of the `BookkeepingController` takes it.
 */
export class JournalEntryReversal implements JournalEntryReversalModel {
    /**
     * The day the reversal is booked on, at midnight UTC, which needs to fall into an open fiscal year.
     */
    @Property.date()
    postingDate!: Date;

    /**
     * Why the entry is reversed, such as `Booked on the wrong account`.
     */
    @Property.string({ maxLength: BookkeepingLimits.TEXT_MAX_LENGTH })
    text!: string;
}