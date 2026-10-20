import { afterEach, describe, expect, it, vi } from 'vitest';

import { KnownPaymentMethod, PaymentMethod } from './models/payment-method.model.ts';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model.ts';
import { Payment } from './models/payment.model.ts';
import { ZibriPaymentPlugin } from './payment.plugin.ts';
import { ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from './payment.tokens.ts';
import { AnyPaymentProviderInterface } from './providers/payment-provider.interface.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { AppState } from '../../global/app-state.enum.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';

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
        validatePaymentData: vi.fn(),
        startPayment: vi.fn(),
        startPaymentReservation: vi.fn(),
        confirmPaymentReservation: vi.fn(),
        confirmPayment: vi.fn(),
        collectPaymentFromReservation: vi.fn(),
        cancelPayment: vi.fn(),
        refundPayment: vi.fn()
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
        // one class per call and this helper runs once per test, so every application here is given
        // the newest, and the earlier ones stay declared without ever being deployed
        dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Payment], allowOrphan: true })],
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
                    return res;
                }
            })
        ]
    });
}

// first, for the reason on startAndStopTestServerWithout
describe('ZibriPaymentPlugin — starting', () => {
    it('refuses to start without Payment, and names it', async () => {
        const provider: ReturnType<typeof createFakeProvider> = createFakeProvider('Provider');
        const providerNameForMethod: Record<string, string> = { [KnownPaymentMethod.PAY_PAL]: 'Provider' };
        const start: Promise<void> = startAndStopTestServerWithout([], {
            plugins: [new ZibriPaymentPlugin()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                    useFactory: () => {
                        const res: PaymentPluginOptionsInput<PaymentMethod[], AnyPaymentProviderInterface[]> = {
                            paymentMethods: [KnownPaymentMethod.PAY_PAL],
                            paymentProviders: [provider],
                            providerNameForMethod
                        };
                        return res;
                    }
                })
            ]
        });

        await expect(start).rejects.toThrow(/Error initializing ZibriPaymentPlugin[\S\s]*- Payment/);
    }, 30000);
});

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
    }, 30000);

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
    }, 30000);
});