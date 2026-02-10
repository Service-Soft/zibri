/* eslint-disable jsdoc/require-jsdoc */
import { PaymentMethod, PaymentPluginOptionsInput } from './models';
import { PaymentProviderInterface } from './providers';
import { InjectionToken, TokenRecord } from '../../di';
import { AnyObject } from '../../entity';

export type DefaultPaymentProviderArray = PaymentProviderInterface<
    PaymentMethod[],
    Record<PaymentMethod, AnyObject & { transactionId: string }>,
    Record<PaymentMethod, AnyObject & { transactionId: string }>,
    Record<PaymentMethod, AnyObject>,
    Record<PaymentMethod, AnyObject>,
    Record<PaymentMethod, boolean>,
    Record<PaymentMethod, boolean>,
    Record<PaymentMethod, boolean>
>[];

/**
 * The dependency injection tokens used by the ZibriPaymentPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_PAYMENT_DI_TOKENS = {
    OPTIONS_INPUT: paymentToken<PaymentPluginOptionsInput<PaymentMethod[], DefaultPaymentProviderArray>>('zi.payment.options_input'),
    OPTIONS: paymentToken<PaymentPluginOptionsInput<PaymentMethod[], DefaultPaymentProviderArray>>('zi.payment.options')
} as const satisfies TokenRecord;

function paymentToken<T = never>(k: `zi.payment.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}