import { type BookkeepingLegalFormModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * A legal form the tenant keeping the books has from a day on, such as `UG` from 2025-01-01.
 */
export class BookkeepingLegalForm implements BookkeepingLegalFormModel {
    /**
     * The legal form, such as `UG` or `GmbH`, which the conformance services read.
     */
    @Property.string({ maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    legalForm!: string;

    /**
     * The day the tenant has it from, at midnight UTC, until the next legal form of its history.
     */
    @Property.date()
    validFrom!: Date;
}