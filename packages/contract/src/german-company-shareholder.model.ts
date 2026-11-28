/**
 * A shareholder of a German company, as the GCD module of the E-Bilanz states it.
 */
export type GermanCompanyShareholderModel = {
    /**
     * The name of the shareholder.
     */
    name: string,
    /**
     * The tax number of the shareholder in the 13 digit format of ELSTER, or null for none.
     */
    taxNumber?: string | null,
    /**
     * The tax identification number of a shareholder who is a person, or null for none.
     */
    taxId?: string | null,
    /**
     * The legal form of the shareholder, or null for a person.
     */
    legalStatus?: string | null,
    /**
     * The share of the shareholder, such as `1/2` (Beteiligungsschlüssel).
     */
    share: string
};
