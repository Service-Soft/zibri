/**
 * The address a party of an electronic invoice receives invoices at, such as its Peppol participant id.
 */
export type ElectronicAddressModel = {
    /**
     * The scheme of the address, from the code list "Electronic Address Scheme", such as `0204` for a Leitweg-ID.
     */
    scheme: string,
    /**
     * The address within its scheme.
     */
    value: string
};
