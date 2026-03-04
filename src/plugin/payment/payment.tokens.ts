/* eslint-disable jsdoc/require-jsdoc */
import { PaymentMethod } from './models/payment-method.model';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model';
import { PaymentProviderInterface } from './providers/payment-provider.interface';
import { TokenRecord } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { AnyObject } from '../../entity/any-object.model';

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