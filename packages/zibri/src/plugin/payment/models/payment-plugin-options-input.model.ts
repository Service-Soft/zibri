import { PaymentMethod } from './payment-method.model.ts';
import { PaymentPluginOptions } from './payment-plugin-options.model.ts';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface.ts';

/**
 * Input for configuring the payment plugin.
 */
export type PaymentPluginOptionsInput<
    M extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = PaymentPluginOptions<M, P>;