/**
 * Known payment methods.
 */
export enum KnownPaymentMethod {
    PAY_PAL = 'PAY_PAL',
    APPLE_PAY = 'APPLE_PAY',
    GOOGLE_PAY = 'GOOGLE_PAY',
    SEPA_BANK_TRANSFER = 'SEPA_BANK_TRANSFER',
    CREDIT_CARD = 'CREDIT_CARD'
}

/**
 * All possible payment methods, including unknown ones.
 */
export type PaymentMethod = KnownPaymentMethod | string & {};