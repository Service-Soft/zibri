import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { KnownPaymentMethod, PaymentMethod } from './models/payment-method.model';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model';
import { PaymentStatus } from './models/payment-status.enum';
import { Payment } from './models/payment.model';
import { ZibriPaymentPlugin } from './payment.plugin';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from './payment.tokens';
import { AnyPaymentProviderInterface } from './providers/payment-provider.interface';
import { PaymentServiceInterface } from './services/payment-service.interface';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { NumberUtilities } from '../../utilities/number.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

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
        validatePaymentData: jest.fn((_method: unknown, data: unknown) => data),
        startPayment: jest.fn(),
        startPaymentReservation: jest.fn(),
        confirmPaymentReservation: jest.fn(),
        confirmPayment: jest.fn(),
        collectPaymentFromReservation: jest.fn(),
        cancelPayment: jest.fn(),
        refundPayment: jest.fn()
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