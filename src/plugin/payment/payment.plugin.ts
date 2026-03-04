import { PaymentMethod } from './models/payment-method.model';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model';
import { PaymentPluginOptions } from './models/payment-plugin-options.model';
import { Payment } from './models/payment.model';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_DI_TOKENS } from './payment.tokens';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { ZibriPlugin } from '../plugin.model';

/**
 * Plugin that includes everything for handling payments.
 */
export class ZibriPaymentPlugin extends ZibriPlugin {

    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_PAYMENT_DI_TOKENS> = {
        OPTIONS_INPUT: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_PAYMENT_DI_TOKENS.OPTIONS_INPUT, []);
            }
        },
        OPTIONS: {
            useFactory: () => {
                const input: PaymentPluginOptionsInput<
                    PaymentMethod[],
                    DefaultPaymentProviderArray
                > = inject(ZIBRI_PAYMENT_DI_TOKENS.OPTIONS_INPUT);
                const res: PaymentPluginOptions<PaymentMethod[], DefaultPaymentProviderArray> = {
                    ...input
                };
                return res;
            }
        }
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_PAYMENT_DI_TOKENS, this.defaultDiProviders);

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(): void {
        validateEntitiesRegistered(this.constructor.name, Payment);
        const options: PaymentPluginOptions<PaymentMethod[], DefaultPaymentProviderArray> = inject(ZIBRI_PAYMENT_DI_TOKENS.OPTIONS);

        const allNames: string[] = options.paymentProviders.map(p => p.name);
        if (allNames.length >= [...new Set(allNames)].length) {
            throw new Error('There are duplicate payment provider names');
        }

        if (options.paymentMethods.length >= [...new Set(options.paymentMethods)].length) {
            throw new Error('There are duplicate payment methods');
        }
    }
}