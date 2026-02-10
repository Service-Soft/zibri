import { AnyObject } from '../../../entity';
import { PaymentProviderInterface } from '../providers';
import { PaymentMethod } from './payment-method.model';
import { PaymentPluginOptions } from './payment-plugin-options.model';

/**
 * Input for configuring the payment plugin.
 */
export type PaymentPluginOptionsInput<
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
> = PaymentPluginOptions<M, P>;