/* eslint-disable jsdoc/require-jsdoc */
import { PaymentMethod } from '../models/payment-method.model';
import { PaymentPluginOptions } from '../models/payment-plugin-options.model';
import { Payment } from '../models/payment.model';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface';

/**
 * Helper: pick the provider *instance* (from the P tuple) for the given method M.
 */
type ProviderInstanceForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]
> = Extract<
    P[number],

    { name: PaymentPluginOptions<Methods, P>['providerNameForMethod'][M] }
>;

/**
 * PaymentDataForMethod: the incoming (raw) data type accepted by the provider.
 */
export type PaymentDataForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]
> = ProviderInstanceForMethod<Methods, M, P> extends { __paymentDataMap: infer DataMap }
    // eslint-disable-next-line typescript/no-explicit-any
    ? (DataMap & Record<string, any>)[M] & { transactionId: string }
    : never;

/**
 * ValidatedPaymentDataForMethod: the validated/normalized data type returned by validatePaymentData.
 */
export type ValidatedPaymentDataForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]

> = ProviderInstanceForMethod<Methods, M, P> extends { __validatedDataMap: infer DataMap }
    // eslint-disable-next-line typescript/no-explicit-any
    ? (DataMap & Record<string, any>)[M]
    : never;

/**
 * The payment entity type used for payments.
 */
export type PaymentForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]

> = Payment<M, (ProviderInstanceForMethod<Methods, M, P>['__providerPaymentDataMap'])[M]>;

/**
 * The payment entity type used for reservation payments.
 */
export type PaymentReservationForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]
> = Payment<M, (ProviderInstanceForMethod<Methods, M, P>['__providerReservationPaymentDataMap'])[M]>;

/**
 * Filters to all methods that are allowed for reservation.
 */
export type AllowedReservationMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = {
    [K in Methods[number]]: ProviderInstanceForMethod<Methods, K, P> extends { __reservationSupportMap: infer RS }
        // eslint-disable-next-line typescript/no-explicit-any
        ? (RS & Record<string, any>)[K] extends true ? K : never
        : never;
}[Methods[number]];

/**
 * Filters to all methods that are allowed for cancellation.
 */
export type AllowedCancellationMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = {
    // eslint-disable-next-line stylistic/max-len
    [K in Methods[number]]: ProviderInstanceForMethod<Methods, K, P> extends { __cancellationSupportMap: infer CS, __reservationSupportMap: infer RS }
        // eslint-disable-next-line typescript/no-explicit-any
        ? (CS & Record<string, any>)[K] extends true ? K : (RS & Record<string, any>)[K] extends true ? K : never
        : never;
}[Methods[number]];

/**
 * Filters to all methods that are allowed for refunding.
 */
export type AllowedRefundMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = {
    [K in Methods[number]]: ProviderInstanceForMethod<Methods, K, P> extends { __refundSupportMap: infer RS }
        // eslint-disable-next-line typescript/no-explicit-any
        ? (RS & Record<string, any>)[K] extends true ? K : never
        : never;
}[Methods[number]];