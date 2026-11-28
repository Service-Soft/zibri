/**
 * An invoice another invoice references, such as the one a credit note corrects.
 */
export type InvoiceReferenceModel = {
    /**
     * The number of the invoice referenced.
     */
    number: string,
    /**
     * The date of the invoice referenced.
     */
    date: Date
};