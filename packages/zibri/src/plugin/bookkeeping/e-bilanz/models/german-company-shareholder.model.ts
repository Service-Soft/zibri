import { type GermanCompanyShareholderModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from '../../models/bookkeeping-limits.model';

/**
 * A shareholder of a German company, as the GCD module of the E-Bilanz states it.
 */
export class GermanCompanyShareholder implements GermanCompanyShareholderModel {
    /**
     * The name of the shareholder.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The tax number of the shareholder in the 13 digit format of ELSTER, or null for none.
     */
    @Property.string({ required: false, regex: /^\d{13}$/ })
    taxNumber?: string | null;

    /**
     * The tax identification number of a shareholder who is a person, or null for none.
     */
    @Property.string({ required: false, regex: /^\d{11}$/ })
    taxId?: string | null;

    /**
     * The legal form of the shareholder, or null for a person.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    legalStatus?: string | null;

    /**
     * The share of the shareholder, such as `1/2` (Beteiligungsschlüssel).
     */
    @Property.string({ minLength: 1, maxLength: 50 })
    share!: string;
}