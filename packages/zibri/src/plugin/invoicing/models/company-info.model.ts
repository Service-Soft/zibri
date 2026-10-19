import { type ElectronicAddress } from './electronic-address.model';

/**
 * Contains base information about the company that issues an invoice.
 */
export type CompanyInfo = {
    /**
     * The logo shown in the header of the invoice, if any. Available options:
     *
     * - A reference by name to an image defined in the `images` of the invoicing options
     * - A data URL
     * - A remote URL via http:// or https://.
     *
     * Supported image formats: JPEG, PNG.
     */
    readonly logo?: string,
    /**
     * The name of the bank to display in the footer.
     * Can be omitted.
     */
    readonly bankName?: string,
    /**
     * The tax office to display in the footer.
     * Can be omitted.
     */
    readonly taxOffice?: string,
    /**
     * The name of the company.
     */
    readonly name: string,
    /**
     * The full name of the company, including the company addendum.
     */
    readonly fullName: string,
    /**
     * The email of the company.
     */
    readonly email: string,
    /**
     * The phone number of the company.
     */
    readonly phone: string,
    /**
     * The address the company receives electronic invoices at. A Peppol invoice requires it, an
     * XRechnung names the company by its email without it.
     */
    readonly electronicAddress?: ElectronicAddress,
    /**
     * The tax number.
     */
    readonly taxNumber?: string,
    /**
     * The vat number.
     */
    readonly vatNumber?: string,
    /**
     * The ceo of the company to display in the footer.
     * Can be omitted.
     */
    readonly ceo?: string,
    /**
     * The IBAN of the company.
     * Can be omitted.
     */
    readonly iban?: string,
    /**
     * The BIC/SWIFT of the company.
     * Can be omitted.
     */
    readonly bic?: string,
    /**
     * The address of the company.
     */
    readonly address: {
        /**
         * The street of the address.
         */
        readonly street: string,
        /**
         * The number of the address.
         */
        readonly number: string,
        /**
         * The 5 digit postcode of the address.
         */
        readonly postcode: string,
        /**
         * The city of the address.
         */
        readonly city: string,
        /**
         * The ISO 3166-1 country id.
         */
        readonly countryId: string
    }
};