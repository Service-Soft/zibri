import { AnyObject } from '../../../entity/any-object.model';
import { PaymentMethod } from '../models/payment-method.model';
import { Payment } from '../models/payment.model';

/**
 * A payment provider interface with loose typing for use in DI.
 */
export interface AnyPaymentProviderInterface {
    /**
     * The unique name of the provider, used to differentiate between them.
     */
    readonly name: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __supportedMethods: readonly PaymentMethod[],
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    readonly __paymentDataMap: Record<string, any>,
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    readonly __validatedDataMap: Record<string, any>,
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    readonly __providerPaymentDataMap: Record<string, any>,
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    readonly __providerReservationPaymentDataMap: Record<string, any>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __cancellationSupportMap: Record<string, boolean>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __refundSupportMap: Record<string, boolean>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __reservationSupportMap: Record<string, boolean>,
    /**
     * Validates the given payment data for the given method.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    validatePaymentData: (method: any, data: any) => any,
    /**
     * Starts a new payment with the given method and data.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    startPayment: (method: any, data: any) => any,
    /**
     * Starts a new payment reservation with the given method and data.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    startPaymentReservation: (method: any, data: any) => any,
    /**
     * Confirms The given payment reservation. This does NOT move any money yet, it just reserves the funds.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    confirmPaymentReservation: (payment: any) => any,
    /**
     * Confirms and finishes a payment.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    confirmPayment: (payment: any) => any,
    /**
     * Collects payment from the given payment reservation.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    collectPaymentFromReservation: (payment: any) => any,
    /**
     * Cancels the given payment.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    cancelPayment: (payment: any) => any,
    /**
     * Refunds the given payment.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    refundPayment: (payment: any) => any
}

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
> extends AnyPaymentProviderInterface {
    // phantom carriers — never set at runtime, only for type inference
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __supportedMethods: SupportedMethods,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __paymentDataMap: PaymentDataForMethod,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __validatedDataMap: ValidatedPaymentDataForMethod,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __providerPaymentDataMap: ProviderPaymentDataForMethod,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __providerReservationPaymentDataMap: ProviderReservationPaymentDataForMethod,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __cancellationSupportMap: CancellationSupport,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __refundSupportMap: RefundSupport,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __reservationSupportMap: ReservationSupport,

    // eslint-disable-next-line jsdoc/require-jsdoc
    validatePaymentData: <M extends SupportedMethods[number]>(
        method: M,
        data: PaymentDataForMethod[M]
    ) => ValidatedPaymentDataForMethod[M] | Promise<ValidatedPaymentDataForMethod[M]>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    startPayment: <M extends SupportedMethods[number]>(
        method: M,
        data: ValidatedPaymentDataForMethod[M]
    ) => Payment<M, ProviderPaymentDataForMethod[M]> | Promise<Payment<M, ProviderPaymentDataForMethod[M]>>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    startPaymentReservation: <
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(
        method: M,
        data: ValidatedPaymentDataForMethod[M]
    ) => Payment<M, ProviderReservationPaymentDataForMethod[M]> | Promise<Payment<M, ProviderReservationPaymentDataForMethod[M]>>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    confirmPaymentReservation: <
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderReservationPaymentDataForMethod[M]>) => void | Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    confirmPayment: <M extends SupportedMethods[number]>(
        payment: Payment<M, ProviderPaymentDataForMethod[M]>
    ) => void | Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    collectPaymentFromReservation: <
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderReservationPaymentDataForMethod[M]>) => void | Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    cancelPayment: <
        M extends {
            [K in SupportedMethods[number]]: CancellationSupport[K] extends true ? K : ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(
        payment: Payment<M, ProviderPaymentDataForMethod[M]> | Payment<M, ProviderReservationPaymentDataForMethod[M]>
    ) => void | Promise<void>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    refundPayment: <
        M extends {
            [K in SupportedMethods[number]]: RefundSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderPaymentDataForMethod[M]>) => void | Promise<void>
}