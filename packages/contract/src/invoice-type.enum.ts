/**
 * The kind of document an invoice is.
 */
export enum InvoiceType {
    /**
     * A commercial invoice, type code 380.
     */
    INVOICE = 'INVOICE',
    /**
     * A credit note, type code 381: it credits the amounts it states of the invoice it references.
     */
    CREDIT_NOTE = 'CREDIT_NOTE'
}
