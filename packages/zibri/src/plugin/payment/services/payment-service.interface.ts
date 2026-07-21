import { PaymentDataForMethod, ValidatedPaymentDataForMethod, PaymentForMethod, AllowedReservationMethods, PaymentReservationForMethod, AllowedCancellationMethods, AllowedRefundMethods } from './payment-service.types';
import { PaymentMethod } from '../models/payment-method.model';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface';

// eslint-disable-next-line jsdoc/require-jsdoc
type MethodsCoveredByProviders<P extends readonly AnyPaymentProviderInterface[]>
    // eslint-disable-next-line jsdoc/require-jsdoc
    = P[number] extends { __supportedMethods: infer SM }
        ? SM extends readonly (infer S)[] ? S : never
        : never;

/**
 * Interface for a payment service.
 */
export interface PaymentServiceInterface<
    Methods extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[],
    // eslint-disable-next-line unusedImports/no-unused-vars
    _Check extends (Methods[number] extends MethodsCoveredByProviders<P>
        // eslint-disable-next-line stylistic/max-len
        ? unknown : 'Error: not all payment methods are covered by the provided providers') = Methods[number] extends MethodsCoveredByProviders<P>
        ? unknown : 'Error: not all payment methods are covered by the provided providers'
> {
    /**
     * Validates the given data of the given payment method.
     */
    validatePaymentData: <M extends Methods[number]>(
        method: M,
        data: PaymentDataForMethod<Methods, M, P>
    ) => ValidatedPaymentDataForMethod<Methods, M, P> | Promise<ValidatedPaymentDataForMethod<Methods, M, P>>,
    /**
     * Starts a payment with the given method and data.
     */
    startPayment: <M extends Methods[number]>(
        method: M,
        data: ValidatedPaymentDataForMethod<Methods, M, P>
    ) => PaymentForMethod<Methods, M, P> | Promise<PaymentForMethod<Methods, M, P>>,
    /**
     * Starts a payment reservation.
     */
    startPaymentReservation: <M extends AllowedReservationMethods<Methods, P>>(
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
    ) => void | Promise<void>
}