import { AnyObject } from '../../../entity/any-object.model';
import { PaymentMethod } from '../models/payment-method.model';
import { Payment } from '../models/payment.model';

// the steps are method signatures rather than function properties: TypeScript compares the
// parameters of a method both ways, so a provider whose steps take only its own methods and data -
// or no method at all, for a step it supports for none - is one of these, which a function property
// taking `unknown` (or even `any`, against a step that takes `never`) would refuse
/* eslint-disable typescript/method-signature-style */
/**
 * A payment provider, whichever methods it takes, as the plugin's tokens hold it.
 */
export interface AnyPaymentProviderInterface {
    /**
     * The unique name of the provider, used to differentiate between them.
     */
    readonly name: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __supportedMethods: readonly PaymentMethod[],
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __paymentDataMap: object,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __validatedDataMap: object,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __providerPaymentDataMap: object,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __providerReservationPaymentDataMap: object,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __cancellationSupportMap: object,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __refundSupportMap: object,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly __reservationSupportMap: object,
    /**
     * How long a buyer has to approve a payment. A payment still `CREATED` after it is reconciled.
     */
    readonly approvalWindowInMs: number,
    /**
     * Validates the given payment data for the given method.
     */
    validatePaymentData(method: unknown, data: unknown): unknown,
    /**
     * Requests a new payment with the given method and data, which `confirmPayment` finishes.
     */
    requestPayment(method: unknown, data: unknown): unknown,
    /**
     * Requests a new payment reservation with the given method and data, which
     * `confirmPaymentReservation` finishes.
     */
    requestPaymentReservation(method: unknown, data: unknown): unknown,
    /**
     * Confirms The given payment reservation. This does NOT move any money yet, it just reserves the funds.
     */
    confirmPaymentReservation(payment: unknown): unknown,
    /**
     * Confirms and finishes a payment.
     */
    confirmPayment(payment: unknown): unknown,
    /**
     * Collects payment from the given payment reservation.
     */
    collectPaymentFromReservation(payment: unknown): unknown,
    /**
     * Cancels the given payment.
     */
    cancelPayment(payment: unknown): unknown,
    /**
     * Refunds the given payment.
     */
    refundPayment(payment: unknown): unknown,
    /**
     * Asks the provider what became of a payment nobody confirmed within `approvalWindowInMs`.
     */
    reconcilePayment(payment: unknown): unknown
}
/* eslint-enable typescript/method-signature-style */

/**
 * Interface for a payment provider.
 */
export interface PaymentProviderInterface<
    SupportedMethods extends readonly PaymentMethod[],
    // `object` rather than AnyObject: the latter carries an index signature, which a type alias
    // satisfies implicitly and a class never does. Requiring it here would have meant payment data
    // could only ever be a type - and a type cannot carry the @Property metadata that validation and
    // OpenAPI generation read, so no provider's payment data could be accepted in a @Body.
    // eslint-disable-next-line jsdoc/require-jsdoc
    PaymentDataForMethod extends Record<SupportedMethods[number], object & { transactionId: string }>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    ValidatedPaymentDataForMethod extends Record<SupportedMethods[number], object & { transactionId: string }>,
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
    requestPayment: <M extends SupportedMethods[number]>(
        method: M,
        data: ValidatedPaymentDataForMethod[M]
    ) => Payment<M, ProviderPaymentDataForMethod[M]> | Promise<Payment<M, ProviderPaymentDataForMethod[M]>>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    requestPaymentReservation: <
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
    >(payment: Payment<M, ProviderPaymentDataForMethod[M]>) => void | Promise<void>,
    /**
     * Asks the provider what became of a payment nobody confirmed within `approvalWindowInMs`, and
     * writes it: paid or reserved when the money moved, cancelled when it did not and no longer can.
     * Leaves the payment as it is when the provider says the money is still moving.
     * @throws When the provider cannot be asked, leaving the payment as it is.
     */
    reconcilePayment: <M extends SupportedMethods[number]>(
        payment: Payment<M, ProviderPaymentDataForMethod[M]> | Payment<M, ProviderReservationPaymentDataForMethod[M]>
    ) => void | Promise<void>
}