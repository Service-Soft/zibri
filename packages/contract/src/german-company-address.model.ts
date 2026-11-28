/**
 * An address in the form German tax filings state it, such as the seat of a company in the E-Bilanz.
 */
export type GermanCompanyAddressModel = {
    /**
     * The street, such as `Hauptstraße`.
     */
    street: string,
    /**
     * The house number, such as `12a`.
     */
    houseNumber: string,
    /**
     * The postal code, such as `10115`.
     */
    postalCode: string,
    /**
     * The city, such as `Berlin`.
     */
    city: string,
    /**
     * The country as its ISO 3166-1 alpha-2 code, such as `DE`.
     */
    country: string
};