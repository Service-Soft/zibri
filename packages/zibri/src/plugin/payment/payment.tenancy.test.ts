import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { KnownPaymentMethod, PaymentMethod } from './models/payment-method.model.ts';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model.ts';
import { PaymentStatus } from './models/payment-status.enum.ts';
import { Payment } from './models/payment.model.ts';
import { ZibriPaymentPlugin } from './payment.plugin.ts';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from './payment.tokens.ts';
import { AnyPaymentProviderInterface } from './providers/payment-provider.interface.ts';
import { PaymentServiceInterface } from './services/payment-service.interface.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface.ts';
import { NumberUtilities } from '../../utilities/number.utilities.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';

/**
 * A provider that accepts any payment data and makes no calls.
 * @returns The provider.
 */
function createFakeProvider(): AnyPaymentProviderInterface {
    return {
        name: 'FakeProvider',
        __supportedMethods: [],
        __paymentDataMap: {},
        __validatedDataMap: {},
        __providerPaymentDataMap: {},
        __providerReservationPaymentDataMap: {},
        __cancellationSupportMap: {},
        __refundSupportMap: {},
        __reservationSupportMap: {},
        validatePaymentData: vi.fn((_method: unknown, data: unknown) => data),
        startPayment: vi.fn(),
        startPaymentReservation: vi.fn(),
        confirmPaymentReservation: vi.fn(),
        confirmPayment: vi.fn(),
        collectPaymentFromReservation: vi.fn(),
        cancelPayment: vi.fn(),
        refundPayment: vi.fn()
    };
}

let server: StartedTestServer | undefined;

describe('payments across tenants', () => {
    beforeAll(async () => {
        server = await startTestServer({
            plugins: [new ZibriPaymentPlugin()],
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Payment] })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                    useFactory: () => {
                        const res: PaymentPluginOptionsInput<[KnownPaymentMethod.PAY_PAL], [AnyPaymentProviderInterface]> = {
                            paymentMethods: [KnownPaymentMethod.PAY_PAL],
                            paymentProviders: [createFakeProvider()],
                            providerNameForMethod: { [KnownPaymentMethod.PAY_PAL]: 'FakeProvider' }
                        };
                        return res as PaymentPluginOptionsInput<PaymentMethod[], DefaultPaymentProviderArray>;
                    }
                })
            ]
        });
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('keeps the payments of each tenant apart, a transactionId repeating only within one', async () => {
        const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        // eslint-disable-next-line typescript/no-unsafe-assignment
        const payments: PaymentServiceInterface<[KnownPaymentMethod.PAY_PAL], [AnyPaymentProviderInterface]> = inject(
            ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.PAYMENT_SERVICE
        );
        const repository: Repository<Payment<KnownPaymentMethod, Record<string, unknown>>> = inject(
            repositoryTokenFor(Payment<KnownPaymentMethod, Record<string, unknown>>)
        );
        const acme: string = UUIDUtilities.generate();
        const transactionId: string = UUIDUtilities.generate();
        const created: Payment<KnownPaymentMethod, Record<string, unknown>> = await tenants.runAs(acme, async () => await repository.create({
            transactionId,
            status: PaymentStatus.CREATED,
            amount: NumberUtilities.new(1),
            currencyCode: 'EUR',
            paymentMethod: KnownPaymentMethod.PAY_PAL
        }));
        const validate: () => Promise<void> = async () => {
            await payments.validatePaymentData(KnownPaymentMethod.PAY_PAL, { transactionId, amount: NumberUtilities.new(1), currencyCode: 'EUR' });
        };

        expect(created.tenantId).toBe(acme);
        await expect(tenants.runAs(acme, validate)).rejects.toThrow(/already exists/);
        await expect(tenants.runAs(UUIDUtilities.generate(), validate)).resolves.toBeUndefined();
    });
});