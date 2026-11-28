/**
 * What made the bank plugin suggest a match of a transaction. Each adds to the confidence of the suggestion.
 */
export enum BankMatchReason {
    /**
     * The remittance information or the end-to-end id names the number of the invoice. Adds 0.6.
     */
    INVOICE_NUMBER = 'INVOICE_NUMBER',
    /**
     * The remittance information or the end-to-end id names the document number of the expense. Adds 0.6.
     */
    DOCUMENT_NUMBER = 'DOCUMENT_NUMBER',
    /**
     * What of the transaction is not matched yet is what of the invoice or the expense is open. Adds 0.25.
     */
    AMOUNT = 'AMOUNT',
    /**
     * The name of the counterparty is that of the recipient of the invoice, or of the supplier of the expense. Adds
     * 0.15, once with `COUNTERPARTY_IBAN`.
     */
    COUNTERPARTY_NAME = 'COUNTERPARTY_NAME',
    /**
     * The IBAN of the counterparty paid an invoice of the same recipient before. Adds 0.15, once with
     * `COUNTERPARTY_NAME`.
     */
    COUNTERPARTY_IBAN = 'COUNTERPARTY_IBAN',
    /**
     * An account match rule of the bookkeeping plugin names the counterparty or the text of the transaction. Adds 0.5
     * for each of the two it names and matches.
     */
    ACCOUNT_RULE = 'ACCOUNT_RULE'
}