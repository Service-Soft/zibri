/**
 * The different status a payment can have.
 */
export enum PaymentStatus {
    /**
     * When the payment has been created but is not confirmed yet.
     * Eg. When waiting for a SEPA transfer to happen.
     */
    CREATED = 'CREATED',
    /**
     * When the payment has ben successfully paid.
     */
    PAID = 'PAID',
    /**
     * When the payment was cancelled through the customer somewhere.
     */
    CANCELLED = 'CANCELLED',
    /**
     * When the payment could not be processed due to an error.
     * The error data with more information is saved on the payment.
     */
    FAILED = 'FAILED',
    /**
     * When the payment has been refunded to the customer.
     */
    REFUNDED = 'REFUNDED',
    /**
     * When the payment has been reserved/frozen but not yet collected.
     */
    RESERVED = 'RESERVED'
}