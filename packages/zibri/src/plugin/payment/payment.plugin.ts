import { PaymentMethod } from './models/payment-method.model.ts';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model.ts';
import { PaymentPluginOptions } from './models/payment-plugin-options.model.ts';
import { Payment } from './models/payment.model.ts';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from './payment.tokens.ts';
import { ZibriApplication } from '../../application/application.ts';
import { NoProviderError } from '../../di/errors/no-provider.error.ts';
import { inject } from '../../di/inject.function.ts';
import { DiProvider } from '../../di/models/di-provider.model.ts';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function.ts';
import { ZibriPlugin } from '../plugin.model.ts';
import { PaymentService } from './services/payment.service.ts';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function.ts';

/**
 * Plugin that includes everything for handling payments.
 */
export class ZibriPaymentPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_PAYMENT_PLUGIN_DI_TOKENS> = {
        OPTIONS_INPUT: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT, []);
            }
        },
        OPTIONS: {
            useFactory: () => {
                const input: PaymentPluginOptionsInput<
                    PaymentMethod[],
                    DefaultPaymentProviderArray
                > = inject(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT);
                const res: PaymentPluginOptions<PaymentMethod[], DefaultPaymentProviderArray> = {
                    ...input
                };
                return res;
            }
        },
        PAYMENT_SERVICE: {
            useClass: PaymentService
        }
    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, Payment);
        validateTokensRegistered(this.constructor.name, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS);

        const options: PaymentPluginOptions<PaymentMethod[], DefaultPaymentProviderArray> = inject(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS);
        const allNames: string[] = options.paymentProviders.map(p => p.name);
        const duplicateNames: string[] = allNames.filter(name => allNames.filter(n => name === n).length > 1);
        if (duplicateNames.length) {
            throw new InternalError(
                [
                    'There are duplicate payment provider names:',
                    ...[...new Set(duplicateNames)].map(n => `- ${n}`)
                ]
            );
        }

        const duplicatePaymentMethods: string[] = options.paymentMethods.filter(
            method => options.paymentMethods.filter(m => method === m).length > 1
        );
        if (duplicatePaymentMethods.length) {
            throw new InternalError(
                [
                    'There are duplicate payment methods:',
                    ...[...new Set(duplicatePaymentMethods)].map(m => `- ${m}`)
                ]
            );
        }
    }
}