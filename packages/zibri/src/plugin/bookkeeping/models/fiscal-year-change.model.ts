import { type FiscalYearChangeModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * A change of an open fiscal year, as `PATCH /fiscal-years/:id` of the `BookkeepingController` and
 * `updateFiscalYear` of the journal service take it. Each property is unchanged when absent.
 */
export class FiscalYearChange implements FiscalYearChangeModel {
    /**
     * The average number of employees during the fiscal year, such as for the size class of a company, or null while
     * it is not known.
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
