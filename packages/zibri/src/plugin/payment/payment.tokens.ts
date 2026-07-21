/* eslint-disable jsdoc/require-jsdoc */
import { PaymentMethod } from './models/payment-method.model';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model';
import { PaymentPluginOptions } from './models/payment-plugin-options.model';
import { AnyPaymentProviderInterface } from './providers/payment-provider.interface';
import { PaymentServiceInterface } from './services/payment-service.interface';
import { TokenRecord } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';

export type DefaultPaymentProviderArray = readonly AnyPaymentProviderInterface[];

/**
 * The dependency injection tokens used by the ZibriPaymentPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_PAYMENT_PLUGIN_DI_TOKENS = {
    OPTIONS_INPUT: paymentToken<PaymentPluginOptionsInput<PaymentMethod[], DefaultPaymentProviderArray>>('zi.payment.options_input'),
    OPTIONS: paymentToken<PaymentPluginOptions<PaymentMethod[], DefaultPaymentProviderArray>>('zi.payment.options'),
    /**
     * Inject with explicit type parameters to get full type safety.
     * @example
     * inject<
     *     PaymentServiceInterface<
     *         [KnownPaymentMethod.PAY_PAL],
     *         [PayPalPaymentProvider]
     *     >
     * >(ZIBRI_PAYMENT_DI_TOKENS.PAYMENT_SERVICE)
     */
    // eslint-disable-next-line typescript/no-explicit-any
    PAYMENT_SERVICE: paymentToken<PaymentServiceInterface<any, any, any>>('zi.payment.payment_service')
} as const satisfies TokenRecord;

function paymentToken<T = never>(k: `zi.payment.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}