import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { KnownPaymentMethod, PaymentMethod } from './models/payment-method.model';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model';
import { Payment } from './models/payment.model';
import { ZibriPaymentPlugin } from './payment.plugin';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from './payment.tokens';
import { AnyPaymentProviderInterface } from './providers/payment-provider.interface';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { AppState } from '../../global/app-state.enum';
import { GlobalRegistry } from '../../global/global-registry';

// eslint-disable-next-line typescript/no-explicit-any
function createFakeProvider(name: string): AnyPaymentProviderInterface & Record<string, any> {
    return {
        name,
        __supportedMethods: [],
        __paymentDataMap: {},
        __validatedDataMap: {},
        __providerPaymentDataMap: {},
        __providerReservationPaymentDataMap: {},
        __cancellationSupportMap: {},
        __refundSupportMap: {},
        __reservationSupportMap: {},
        validatePaymentData: jest.fn(),
        startPayment: jest.fn(),
        startPaymentReservation: jest.fn(),
        confirmPaymentReservation: jest.fn(),
        confirmPayment: jest.fn(),
        collectPaymentFromReservation: jest.fn(),
        cancelPayment: jest.fn(),
        refundPayment: jest.fn()
    };
}

async function startWith(
    paymentMethods: PaymentMethod[],
    // eslint-disable-next-line typescript/no-explicit-any
    paymentProviders: (AnyPaymentProviderInterface & Record<string, any>)[],
    providerNameForMethod: Record<string, string>
): Promise<StartedTestServer> {
    return startTestServer({
        plugins: [new ZibriPaymentPlugin()],
        dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Payment] })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                useFactory: () => {
                    const res: PaymentPluginOptionsInput<PaymentMethod[], AnyPaymentProviderInterface[]> = {
                        paymentMethods,
                        paymentProviders,
                        providerNameForMethod
                    };
                    return res as PaymentPluginOptionsInput<PaymentMethod[], DefaultPaymentProviderArray>;
                }
            })
        ]
    });
}

describe('ZibriPaymentPlugin.validate', () => {
    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
        GlobalRegistry['appData'].state = AppState.OFFLINE;
    }, 15000);

    it('starts successfully with unique provider names and payment methods', async () => {
        const provider: ReturnType<typeof createFakeProvider> = createFakeProvider('Provider');
        server = await startWith(
            [KnownPaymentMethod.PAY_PAL],
            [provider],
            { [KnownPaymentMethod.PAY_PAL]: 'Provider' }
        );
        await expect(server.start()).resolves.toEqual(expect.any(String));
    }, 15000);

    it('rejects duplicate payment provider names', async () => {
        const providerA: ReturnType<typeof createFakeProvider> = createFakeProvider('Duplicate');
        const providerB: ReturnType<typeof createFakeProvider> = createFakeProvider('Duplicate');
        await expect(startWith(
            [KnownPaymentMethod.PAY_PAL, KnownPaymentMethod.CREDIT_CARD],
            [providerA, providerB],
            {
                [KnownPaymentMethod.PAY_PAL]: 'Duplicate',
                [KnownPaymentMethod.CREDIT_CARD]: 'Duplicate'
            }
        )).rejects.toThrow(/duplicate payment provider names/);
    }, 15000);

    it('rejects duplicate payment methods', async () => {
        const provider: ReturnType<typeof createFakeProvider> = createFakeProvider('Provider');
        await expect(startWith(
            [KnownPaymentMethod.PAY_PAL, KnownPaymentMethod.PAY_PAL],
            [provider],
            { [KnownPaymentMethod.PAY_PAL]: 'Provider' }
        )).rejects.toThrow(/duplicate payment methods/);
    }, 15000);
});