import { type GermanCompanyAddressModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from '../../models/bookkeeping-limits.model';

/**
 * An address in the form German tax filings state it, such as the seat of a company in the E-Bilanz.
 */
export class GermanCompanyAddress implements GermanCompanyAddressModel {
    /**
     * The street, such as `Hauptstraße`.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    street!: string;

    /**
     * The house number, such as `12a`.
     */
    @Property.string({ minLength: 1, maxLength: 20 })
    houseNumber!: string;

    /**
     * The postal code, such as `10115`.
     */
    @Property.string({ minLength: 1, maxLength: 20 })
    postalCode!: string;

    /**
     * The city, such as `Berlin`.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    city!: string;

    /**
     * The country as its ISO 3166-1 alpha-2 code, such as `DE`.
     */
    @Property.string({ regex: /^[A-Z]{2}$/ })
    country!: string;
}