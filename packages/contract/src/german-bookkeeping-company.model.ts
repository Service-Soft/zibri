import { type BookkeepingCompanyModel } from './bookkeeping-company.model';
import { type EBilanzSenderModel } from './e-bilanz-sender.model';
import { type GermanCompanyAddressModel } from './german-company-address.model';
import { type GermanCompanyShareholderModel } from './german-company-shareholder.model';

/**
 * The company whose books they are, with what a German tax filing such as the E-Bilanz states of it beside its name,
 * seat and register.
 */
export type GermanBookkeepingCompanyModel = BookkeepingCompanyModel & {
    /**
     * The legal form as the GCD module of the HGB taxonomy names it, such as `GmbH` or `UG`.
     */
    legalStatus: string,
    /**
     * The tax number in the 13 digit format of ELSTER, such as `1121081508150`.
     */
    taxNumber: string,
    /**
     * The 4 digit number of the tax office the company files with (Bundesfinanzamtsnummer), such as `1121`.
     */
    taxOfficeNumber: string,
    /**
     * The 17 character economic identification number (W-IdNr.), such as `DE123456789-00001`, or null for none.
     */
    economicId?: string | null,
    /**
     * The address of the seat of the company.
     */
    address: GermanCompanyAddressModel,
    /**
     * What the company does (Geschäftstätigkeit), such as `Software development`.
     */
    business: string,
    /**
     * Whether a tax advisor prepares the filings of the company, which gives them the later deadline of § 149 (3) AO.
     */
    taxAdvisor: boolean,
    /**
     * Who sends the filings, or null for the company itself.
     */
    sender?: EBilanzSenderModel | null,
    /**
     * The shareholders of the company.
     */
    shareholders?: GermanCompanyShareholderModel[] | null
};