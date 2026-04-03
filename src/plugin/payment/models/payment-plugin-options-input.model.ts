import { PaymentMethod } from './payment-method.model';
import { PaymentPluginOptions } from './payment-plugin-options.model';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface';

/**
 * Input for configuring the payment plugin.
 */
export type PaymentPluginOptionsInput<
    M extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = PaymentPluginOptions<M, P>;