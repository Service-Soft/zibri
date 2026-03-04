import { PaymentMethod } from './payment-method.model';
import { AnyObject } from '../../../entity/any-object.model';
import { PaymentProviderInterface } from '../providers/payment-provider.interface';

/**
 * Configuration for the payment plugin.
 */
export type PaymentPluginOptions<
    M extends readonly PaymentMethod[],
    P extends readonly PaymentProviderInterface<
        M[number][],
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<M[number], AnyObject & { transactionId: string }>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        Record<M[number], AnyObject & { transactionId: string }>,
        Record<M[number], AnyObject>,
        Record<M[number], AnyObject>,
        Record<M[number], boolean>,
        Record<M[number], boolean>,
        Record<M[number], boolean>
    >[]
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