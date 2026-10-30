import { PaymentDataForMethod, ValidatedPaymentDataForMethod, PaymentForMethod, AllowedReservationMethods, PaymentReservationForMethod, AllowedCancellationMethods, AllowedRefundMethods } from './payment-service.types';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface';

/**
 * The methods the given providers take between them.
 */
export type MethodsCoveredByProviders<P extends readonly AnyPaymentProviderInterface[]> = P[number]['__supportedMethods'][number];

/**
 * Interface for a payment service.
 */
// a method no provider takes is refused by the constraint on Methods itself: a check in a defaulted
// type parameter defaults to its own constraint, and so never fails
export interface PaymentServiceInterface<
    Methods extends readonly MethodsCoveredByProviders<P>[],
    P extends readonly AnyPaymentProviderInterface[]
> {
    /**
     * Validates the given data of the given payment method.
     */
    validatePaymentData: <M extends Methods[number]>(
        method: M,
        data: PaymentDataForMethod<Methods, M, P>
    ) => ValidatedPaymentDataForMethod<Methods, M, P> | Promise<ValidatedPaymentDataForMethod<Methods, M, P>>,
    /**
     * Requests a payment with the given method and data, which `confirmPayment` finishes.
     */
    requestPayment: <M extends Methods[number]>(
        method: M,
        data: ValidatedPaymentDataForMethod<Methods, M, P>
    ) => PaymentForMethod<Methods, M, P> | Promise<PaymentForMethod<Methods, M, P>>,
    /**
     * Requests a payment reservation, which `confirmPaymentReservation` finishes.
     */
    requestPaymentReservation: <M extends AllowedReservationMethods<Methods, P>>(
        method: M,
        data: ValidatedPaymentDataForMethod<Methods, M, P>
    ) => PaymentReservationForMethod<Methods, M, P> | Promise<PaymentReservationForMethod<Methods, M, P>>,
    /**
     * Confirms a payment reservations. This just reserves/freezes the funds, it does NOT move any money yet.
     */
    confirmPaymentReservation: <M extends AllowedReservationMethods<Methods, P>>(
        payment: PaymentReservationForMethod<Methods, M, P>
    ) => void | Promise<void>,
    /**
     * Confirms the given payment.
     */
    confirmPayment: <M extends Methods[number]>(payment: PaymentForMethod<Methods, M, P>) => void | Promise<void>,
    /**
     * Collects a payment of the given reserved payment.
     */
    collectPaymentFromReservation: <M extends AllowedReservationMethods<Methods, P>>(
        payment: PaymentReservationForMethod<Methods, M, P>
    ) => void | Promise<void>,
    /**
     * Cancels the given payment. Only works if it has not been paid already.
     */
    cancelPayment: <M extends AllowedCancellationMethods<Methods, P>>(
        payment: PaymentForMethod<Methods, M, P> | PaymentReservationForMethod<Methods, M, P>
    ) => void | Promise<void>,
    /**
     * Refunds the given payment.
     */
    refundPayment: <M extends AllowedRefundMethods<Methods, P>>(
        payment: PaymentForMethod<Methods, M, P>
    ) => void | Promise<void>,
    /**
     * Asks the providers what became of the payments of every tenant that are still `CREATED` after
     * their provider's `approvalWindowInMs`, and records it. `PaymentReconciliationCronJob` calls it
     * every hour.
     * @returns How many payments were asked about.
     * @throws When a provider could not be asked about one of them, after the others were.
     */
    reconcileAbandonedPayments: () => Promise<number>
}