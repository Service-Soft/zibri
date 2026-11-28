import { type FiscalYearReopeningModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * How to reopen a closed fiscal year to correct its books, as `POST /fiscal-years/:id/reopening` takes it.
 */
export class FiscalYearReopening implements FiscalYearReopeningModel {
    /**
     * Why the fiscal year is reopened, such as the error to correct. The text of the entries reversing its closing.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.TEXT_MAX_LENGTH })
    reason!: string;

    /**
     * Whether it is reopened to correct accounts already filed with the tax administration, such as an E-Bilanz
     * accepted, which is then filed again as a correction. A fiscal year whose accounts are filed is reopened only so.
     * False by default.
     */
    @Property.boolean({ required: false })
    forCorrection?: boolean | null;
}

/**
 * What reopening a fiscal year takes from code: the reopening, and the user it is of.
 */
export type FiscalYearReopeningPosting = FiscalYearReopening & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    createdBy?: string | null
};
