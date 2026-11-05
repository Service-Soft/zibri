/* eslint-disable jsdoc/require-jsdoc */
import { AnyObject } from '../../../entity/any-object.model';
import { PaymentMethod } from '../models/payment-method.model';
import { Payment } from '../models/payment.model';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface';

/**
 * Helper: the providers among `Provider` that take the method M.
 */
// distributes over a union of providers, since Provider is checked on its own. A provider known only
// as AnyPaymentProviderInterface takes every method
type ProviderForMethod<M extends PaymentMethod, Provider extends AnyPaymentProviderInterface> = Provider extends AnyPaymentProviderInterface
    ? M extends Provider['__supportedMethods'][number] ? Provider : never
    : never;

/**
 * Helper: the maps of a provider that hold a type per method.
 */
type DataMapKey = '__paymentDataMap' | '__validatedDataMap' | '__providerPaymentDataMap' | '__providerReservationPaymentDataMap';

/**
 * Helper: the maps of a provider that say per method whether it supports a step.
 */
type SupportMapKey = '__cancellationSupportMap' | '__refundSupportMap' | '__reservationSupportMap';

/**
 * Helper: what a provider's map holds for the method M.
 */
// indexed only where the map names the method: intersecting it with an index signature of `any` to
// make it indexable turned every entry into `any`. A provider known only loosely names no method,
// and takes any object
type DataForMethod<Provider, Key extends DataMapKey, M> = Provider extends AnyPaymentProviderInterface
    ? M extends keyof Provider[Key] ? Provider[Key][M] : AnyObject
    : never;

/**
 * Helper: whether a provider supports a step for the method M. A provider known only loosely is
 * taken to support every step.
 */
type SupportForMethod<Provider, Key extends SupportMapKey, M> = Provider extends AnyPaymentProviderInterface
    ? M extends keyof Provider[Key] ? Provider[Key][M] : true
    : never;

/**
 * PaymentDataForMethod: the incoming (raw) data type accepted by the provider.
 */
export type PaymentDataForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]
> = DataForMethod<ProviderForMethod<M, P[number]>, '__paymentDataMap', M> & { transactionId: string };

/**
 * ValidatedPaymentDataForMethod: the validated/normalized data type returned by validatePaymentData.
 */
export type ValidatedPaymentDataForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]
> = DataForMethod<ProviderForMethod<M, P[number]>, '__validatedDataMap', M>;

/**
 * The payment entity type used for payments.
 */
export type PaymentForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]
> = Payment<M, Extract<DataForMethod<ProviderForMethod<M, P[number]>, '__providerPaymentDataMap', M>, AnyObject>>;

/**
 * The payment entity type used for reservation payments.
 */
export type PaymentReservationForMethod<
    Methods extends readonly PaymentMethod[],
    M extends Methods[number],
    P extends readonly AnyPaymentProviderInterface[]
> = Payment<M, Extract<DataForMethod<ProviderForMethod<M, P[number]>, '__providerReservationPaymentDataMap', M>, AnyObject>>;

/**
 * Filters to all methods that are allowed for reservation.
 */
export type AllowedReservationMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = {
    [K in Methods[number]]: SupportForMethod<ProviderForMethod<K, P[number]>, '__reservationSupportMap', K> extends true ? K : never;
}[Methods[number]];

/**
 * Filters to all methods that are allowed for cancellation.
 */
export type AllowedCancellationMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = {
    [K in Methods[number]]: SupportForMethod<ProviderForMethod<K, P[number]>, '__cancellationSupportMap', K> extends true
        ? K
        : SupportForMethod<ProviderForMethod<K, P[number]>, '__reservationSupportMap', K> extends true ? K : never;
}[Methods[number]];

/**
 * Filters to all methods that are allowed for refunding.
 */
export type AllowedRefundMethods<
    Methods extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = {
    [K in Methods[number]]: SupportForMethod<ProviderForMethod<K, P[number]>, '__refundSupportMap', K> extends true ? K : never;
}[Methods[number]];