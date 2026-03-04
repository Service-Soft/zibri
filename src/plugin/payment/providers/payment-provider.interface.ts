import { AnyObject } from '../../../entity/any-object.model';
import { PaymentMethod } from '../models/payment-method.model';
import { Payment } from '../models/payment.model';

/**
 * Interface for a payment provider.
 */
export interface PaymentProviderInterface<
    SupportedMethods extends readonly PaymentMethod[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    PaymentDataForMethod extends Record<SupportedMethods[number], AnyObject & { transactionId: string }>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    ValidatedPaymentDataForMethod extends Record<SupportedMethods[number], AnyObject & { transactionId: string }>,
    ProviderPaymentDataForMethod extends Record<SupportedMethods[number], AnyObject>,
    ProviderReservationPaymentDataForMethod extends Record<SupportedMethods[number], AnyObject>,
    CancellationSupport extends Record<SupportedMethods[number], boolean>,
    RefundSupport extends Record<SupportedMethods[number], boolean>,
    ReservationSupport extends Record<SupportedMethods[number], boolean>
> {
    /**
     * The unique name of the provider, used to differentiate between them.
     */
    readonly name: string,
    /**
     * A map that defines which payment methods support cancellation.
     */
    readonly cancellationSupported: CancellationSupport,
    /**
     * A map that defines which payment methods support refunding.
     */
    readonly refundSupported: RefundSupport,
    /**
     * A map that defines which payment methods support reservation.
     */
    readonly reservationSupported: ReservationSupport,
    /**
     * Validates the given payment data for the given method.
     */
    validatePaymentData: <M extends SupportedMethods[number]>(
        method: M,
        data: PaymentDataForMethod[M]
    ) => ValidatedPaymentDataForMethod[M] | Promise<ValidatedPaymentDataForMethod[M]>,
    /**
     * Starts a new payment with the given method and data.
     */
    startPayment: <M extends SupportedMethods[number]>(
        method: M,
        data: ValidatedPaymentDataForMethod[M]
    ) => Payment<M, ProviderPaymentDataForMethod[M]> | Promise<Payment<M, ProviderPaymentDataForMethod[M]>>,
    /**
     * Starts a new payment reservation with the given method and data.
     */
    startPaymentReservation: <
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(
        method: M,
        data: ValidatedPaymentDataForMethod[M]
    ) => Payment<M, ProviderReservationPaymentDataForMethod[M]> | Promise<Payment<M, ProviderReservationPaymentDataForMethod[M]>>,
    /**
     * Confirms The given payment reservation. This does NOT move any money yet, it just reserves the funds.
     */
    confirmPaymentReservation: <
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderReservationPaymentDataForMethod[M]>) => void | Promise<void>,
    /**
     * Confirms and finishes a payment.
     */
    confirmPayment: <M extends SupportedMethods[number]>(
        payment: Payment<M, ProviderPaymentDataForMethod[M]>
    ) => void | Promise<void>,
    /**
     * Collects payment from the given payment reservation.
     */
    collectPaymentFromReservation: <
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderReservationPaymentDataForMethod[M]>) => void | Promise<void>,
    /**
     * Cancels the given payment.
     */
    cancelPayment: <
        M extends {
            [K in SupportedMethods[number]]: CancellationSupport[K] extends true ? K : ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(
        payment: Payment<M, ProviderPaymentDataForMethod[M]> | Payment<M, ProviderReservationPaymentDataForMethod[M]>
    ) => void | Promise<void>,
    /**
     * Refunds the given payment.
     */
    refundPayment: <
        M extends {
            [K in SupportedMethods[number]]: RefundSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderPaymentDataForMethod[M]>) => void | Promise<void>
}