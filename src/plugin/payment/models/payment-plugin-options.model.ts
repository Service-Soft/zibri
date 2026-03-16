import { PaymentMethod } from './payment-method.model';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface';

/**
 * Configuration for the payment plugin.
 */
export type PaymentPluginOptions<
    M extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
> = {
    /**
     * The payment methods to use (credit card, bank transfer etc.).
     */
    readonly paymentMethods: M,
    /**
     * The payment providers to register (Stripe, PayPal etc.).
     */
    readonly paymentProviders: P,
    /**
     * The mapping of which payment provider should be used for what payment method.
     */
    readonly providerNameForMethod: Record<M[number], P[number]['name']>
};