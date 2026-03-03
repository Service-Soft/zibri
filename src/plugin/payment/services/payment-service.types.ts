/* eslint-disable unusedImports/no-unused-vars */
import { AnyObject } from '../../../entity';
import { Payment, PaymentMethod, PaymentPluginOptions } from '../models';
import { PaymentProviderInterface } from '../providers';

/**
 * Helper: pick the provider *instance* (from the P tuple) for the given method M.
 */
type ProviderInstanceForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly PaymentProviderInterface<
        Methods[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>
    >[]
> = Extract<
    P[number],
    // eslint-disable-next-line jsdoc/require-jsdoc
    { name: PaymentPluginOptions<Methods, P>['providerNameForMethod'][M] }
>;

/**
 * PaymentDataForMethod: the incoming (raw) data type accepted by the provider.
 */
export type PaymentDataForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly PaymentProviderInterface<
        Methods[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>
    >[]
>
    = ProviderInstanceForMethod<Methods, M, P> extends PaymentProviderInterface<
        infer _SM,
        infer PaymentDataMap,
        infer _ValidatedMap,
        infer _ProviderPaymentData,
        infer _ProviderReservationPaymentData,
        infer _CS,
        infer _RS,
        infer _ReservationSupport
    >
        ? PaymentDataMap[M]
        : never;

/**
 * ValidatedPaymentDataForMethod: the validated/normalized data type returned by validatePaymentData.
 */
export type ValidatedPaymentDataForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly PaymentProviderInterface<
        Methods[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>
    >[]
>
    = ProviderInstanceForMethod<Methods, M, P> extends PaymentProviderInterface<
        infer _SM,
        infer _PaymentDataMap,
        infer ValidatedMap,
        infer _ProviderPaymentData,
        infer _ProviderReservationPaymentData,
        infer _CS,
        infer _RS,
        infer _ReservationSupport
    >
        ? ValidatedMap[M]
        : never;

/**
 * The payment entity type used for payments.
 */
export type PaymentForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly PaymentProviderInterface<
        Methods[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>
    >[]
>
    = ProviderInstanceForMethod<Methods, M, P> extends PaymentProviderInterface<
        infer _SM,
        infer _PaymentDataMap,
        infer _ValidatedMap,
        infer ProviderPaymentDataMap,
        infer _ProviderReservationPaymentData,
        infer _CS,
        infer _RS,
        infer _ReservationSupport
    >
        ? Payment<M, ProviderPaymentDataMap[M]>
        : never;

/**
 * The payment entity type used for reservation payments.
 */
export type PaymentReservationForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly PaymentProviderInterface<
        Methods[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>
    >[]
>
    = ProviderInstanceForMethod<Methods, M, P> extends PaymentProviderInterface<
        infer _SM,
        infer _PaymentDataMap,
        infer _ValidatedMap,
        infer _ProviderPaymentDataMap,
        infer ProviderReservationPaymentDataMap,
        infer _CS,
        infer _RS,
        infer _ReservationSupport
    >
        ? Payment<M, ProviderReservationPaymentDataMap[M]>
        : never;

/**
 * Filters to all methods that are allowed for reservation.
 */
export type AllowedReservationMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly PaymentProviderInterface<
        Methods[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>
    >[]
> = {
    [K in Methods[number]]: ProviderInstanceForMethod<Methods, K, P> extends PaymentProviderInterface<
        infer _SM,
        infer _PaymentDataMap,
        infer _ValidatedMap,
        infer _ProviderPaymentDataMap,
        infer _ProviderReservationPaymentDataMap,
        infer _CancellationSupport,
        infer _RefundSupport,
        infer ReservationSupport
    >
        ? ReservationSupport[K] extends true
            ? K
            : never
        : never;
}[Methods[number]];

/**
 * Filters to all methods that are allowed for cancellation.
 */
export type AllowedCancellationMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly PaymentProviderInterface<
        Methods[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>
    >[]
> = {
    [K in Methods[number]]: ProviderInstanceForMethod<Methods, K, P> extends PaymentProviderInterface<
        infer _SM,
        infer _PaymentDataMap,
        infer _ValidatedMap,
        infer _ProviderPaymentDataMap,
        infer _ProviderReservationPaymentDataMap,
        infer CancellationSupport,
        infer _RefundSupport,
        infer ReservationSupport
    >
        ? CancellationSupport[K] extends true
            ? K
            : ReservationSupport[K] extends true ? K : never
        : never;
}[Methods[number]];

/**
 * Filters to all methods that are allowed for refunding.
 */
export type AllowedRefundMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly PaymentProviderInterface<
        Methods[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<Methods[number], AnyObject & { transactionId: string }>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], AnyObject>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>,
        Record<Methods[number], boolean>
    >[]
> = {
    [K in Methods[number]]: ProviderInstanceForMethod<Methods, K, P> extends PaymentProviderInterface<
        infer _SM,
        infer _PaymentDataMap,
        infer _ValidatedMap,
        infer _ProviderPaymentDataMap,
        infer _ProviderReservationPaymentDataMap,
        infer _CancellationSupport,
        infer _RefundSupport,
        infer _ReservationSupport
    >
        ? _RefundSupport[K] extends true
            ? K
            : never
        : never;
}[Methods[number]];