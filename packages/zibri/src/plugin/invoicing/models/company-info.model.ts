/**
 * Contains base information about a company.
 */
export type CompanyInfo = {
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