import { type NewFiscalYearModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * A fiscal year to add to the books of a tenant, as `POST /fiscal-years` of the `BookkeepingController` and
 * `createFiscalYear` of the journal service take it.
 */
export class NewFiscalYear implements NewFiscalYearModel {
    /**
     * The first day, at midnight UTC. The day after the end of the fiscal year before it by default, and required for
     * the first fiscal year.
     */
    @Property.date({ required: false })
    start?: Date | null;

    /**
     * The last day, at midnight UTC. The day before the same day a year after the start by default, or the end of the
     * calendar year of the start for the first fiscal year.
     */
    @Property.date({ required: false })
    end?: Date | null;

    /**
     * The names of the conformances that apply, in place of those the legal form of the tenant at the end derives.
     */
    @Property.array({ items: { type: 'string', maxLength: BookkeepingLimits.CONFORMANCE_NAME_MAX_LENGTH }, required: false })
    conformances?: string[] | null;

    /**
     * The average number of employees during the fiscal year, or null while it is not known.
     */
    @Property.number({ min: 0, required: false })
    averageEmployees?: number | null;

    /**
     * The text stated below the balance sheet where the conformances state one, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NOTE_MAX_LENGTH })
    balanceSheetNote?: string | null;

    /**
     * Whether the company was founded in the fiscal year, for the first fiscal year of the books.
     */
    @Property.boolean({ required: false })
    founded?: boolean | null;

    /**
     * The size class the company had at the balance sheet date before the first fiscal year of the books, such as
     * `SMALL`.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    previousSizeClass?: string | null;
}