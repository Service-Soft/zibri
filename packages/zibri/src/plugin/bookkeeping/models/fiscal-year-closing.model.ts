import { type FiscalYearClosingModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * How to close a fiscal year, as `POST /fiscal-years/:id/closing` of the `BookkeepingController` and
 * `closeFiscalYear` of the journal service take it.
 */
export class FiscalYearClosing implements FiscalYearClosingModel {
    /**
     * The id of the equity account the result of the year, revenue less expenses, is carried into.
     */
    @Property.string({ format: 'uuid' })
    resultAccountId!: string;
}