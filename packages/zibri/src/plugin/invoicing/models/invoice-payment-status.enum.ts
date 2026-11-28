/**
 * How far an invoice is paid, as its payment state says.
 */
export enum InvoicePaymentStatus {
    /**
     * Nothing of it is paid, and part of it is open.
     */
    OPEN = 'OPEN',
    /**
     * Part of it is paid, and part of it is open.
     */
    PARTLY_PAID = 'PARTLY_PAID',
    /**
     * Nothing of it is open, and part of it is paid.
     */
    PAID = 'PAID',
    /**
     * Its credit notes credit all of it, and nothing of it is paid.
     */
    CREDITED = 'CREDITED'
}