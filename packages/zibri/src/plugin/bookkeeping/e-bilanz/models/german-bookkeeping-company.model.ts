import { type GermanBookkeepingCompanyModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { BookkeepingCompany } from '../../models/bookkeeping-company.model';
import { BookkeepingLimits } from '../../models/bookkeeping-limits.model';
import { EBilanzSender } from './e-bilanz-sender.model';
import { GermanCompanyAddress } from './german-company-address.model';
import { GermanCompanyShareholder } from './german-company-shareholder.model';

/**
 * The company whose books they are, with what the E-Bilanz states of it beside its name, seat and register: the
 * fields of the GCD module of the HGB taxonomy a corporation fills, the tax office it files with, and who sends it.
 */
export class GermanBookkeepingCompany extends BookkeepingCompany implements GermanBookkeepingCompanyModel {
    /**
     * The legal form as the GCD module of the HGB taxonomy names it, such as `GmbH` or `UG`.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    legalStatus!: string;

    /**
     * The tax number in the 13 digit format of ELSTER, such as `1121081508150`.
     */
    @Property.string({ regex: /^\d{13}$/ })
    taxNumber!: string;

    /**
     * The 4 digit number of the tax office the company files with (Bundesfinanzamtsnummer), such as `1121`.
     */
    @Property.string({ regex: /^\d{4}$/ })
    taxOfficeNumber!: string;

    /**
     * The 17 character economic identification number (W-IdNr.), such as `DE123456789-00001`, or null for none.
     */
    @Property.string({ required: false, regex: /^DE\d{9}-\d{5}$/ })
    economicId?: string | null;

    /**
     * The address of the seat of the company.
     */
    @Property.object({ cls: () => GermanCompanyAddress })
    address!: GermanCompanyAddress;

    /**
     * What the company does (Geschäftstätigkeit), such as `Software development`.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    business!: string;

    /**
     * Whether a tax advisor prepares the filings of the company, which gives them the later deadline of § 149 (3) AO.
     */
    @Property.boolean()
    taxAdvisor!: boolean;

    /**
     * Who sends the filings, or null for the company itself.
     */
    @Property.object({ cls: () => EBilanzSender, required: false })
    sender?: EBilanzSender | null;

    /**
     * The shareholders of the company.
     */
    @Property.array({ items: { type: 'object', cls: () => GermanCompanyShareholder }, required: false })
    shareholders?: GermanCompanyShareholder[] | null;
}
