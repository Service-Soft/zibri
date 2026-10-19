import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { PaymentServiceInterface } from './payment-service.interface';
import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { NumberUtilities } from '../../../utilities/number.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { KnownPaymentMethod, PaymentMethod } from '../models/payment-method.model';
import { PaymentPluginOptionsInput } from '../models/payment-plugin-options-input.model';
import { PaymentStatus } from '../models/payment-status.enum';
import { Payment } from '../models/payment.model';
import { ZibriPaymentPlugin } from '../payment.plugin';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from '../payment.tokens';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface';

// eslint-disable-next-line typescript/no-explicit-any
function createFakeProvider(): AnyPaymentProviderInterface & Record<string, any> {
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

/**
 * The tenant every payment of this suite is stored in.
 */
const tenantId: string = UUIDUtilities.generate();

/**
 * Runs work in the tenant of this suite's payments.
 * @param work - The work.
 * @returns What the work returns.
 */
async function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

describe('PaymentService', () => {
    let server: StartedTestServer;
    let paymentService: PaymentServiceInterface<[KnownPaymentMethod.PAY_PAL], [AnyPaymentProviderInterface]>;
    let paymentRepository: Repository<Payment<KnownPaymentMethod, Record<string, unknown>>>;
    let provider: ReturnType<typeof createFakeProvider>;

    /**
     * Stores a payment in the given status. A transition is judged by the stored payment, so the
     * one it is handed has to be stored.
     * @param status - The status.
     * @returns The payment.
     */
    async function createPayment(status: PaymentStatus): Promise<Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>>> {
        const payment: Payment<KnownPaymentMethod, Record<string, unknown>> = await inTenant(async () => await paymentRepository.create({
            transactionId: UUIDUtilities.generate(),
            status,
            amount: NumberUtilities.new(10),
            currencyCode: 'EUR',
            paymentMethod: KnownPaymentMethod.PAY_PAL
        }));
        return { ...payment, paymentMethod: KnownPaymentMethod.PAY_PAL };
    }

    beforeAll(async () => {
        provider = createFakeProvider();

        server = await startTestServer({
            plugins: [new ZibriPaymentPlugin()],
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Payment] })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                    useFactory: () => {
                        const res: PaymentPluginOptionsInput<[KnownPaymentMethod.PAY_PAL], [AnyPaymentProviderInterface]> = {
                            paymentMethods: [KnownPaymentMethod.PAY_PAL],
                            paymentProviders: [provider],
                            providerNameForMethod: {
                                [KnownPaymentMethod.PAY_PAL]: 'FakeProvider'
                            }
                        };
                        return res as PaymentPluginOptionsInput<PaymentMethod[], DefaultPaymentProviderArray>;
                    }
                })
            ]
        });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        paymentService = inject(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.PAYMENT_SERVICE);
        paymentRepository = inject(repositoryTokenFor(Payment<KnownPaymentMethod, Record<string, unknown>>));
    }, 40000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('validatePaymentData', () => {
        it('rejects a duplicate transactionId in the tenant', async () => {
            const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
            const ownTenantId: string = UUIDUtilities.generate();
            const transactionId: string = UUIDUtilities.generate();
            await tenants.runAs(ownTenantId, async () => await paymentRepository.create({
                transactionId,
                status: PaymentStatus.CREATED,
                amount: NumberUtilities.new(1),
                currencyCode: 'EUR',
                paymentMethod: KnownPaymentMethod.PAY_PAL
            }));

            const validate: () => Promise<void> = async () => {
                await paymentService.validatePaymentData(
                    KnownPaymentMethod.PAY_PAL,
                    { transactionId, amount: NumberUtilities.new(1), currencyCode: 'EUR' }
                );
            };
            await expect(tenants.runAs(ownTenantId, validate)).rejects.toThrow(/already exists/);
            // another tenant's payment of the same transactionId is none of this one
            await expect(tenants.runAs(UUIDUtilities.generate(), validate)).resolves.toBeUndefined();
        });
    });

    describe('confirmPaymentReservation', () => {
        it('calls the provider when status is CREATED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.CREATED);
            await inTenant(async () => await paymentService.confirmPaymentReservation(payment));
            expect(provider.confirmPaymentReservation).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already RESERVED', async () => {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(logger, 'warn');
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.RESERVED);

            await inTenant(async () => await paymentService.confirmPaymentReservation(payment));

            expect(provider.confirmPaymentReservation).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('throws for any other status', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.PAID);
            await expect(inTenant(async () => await paymentService.confirmPaymentReservation(payment))).rejects.toThrow(/Cannot confirm payment/);
            expect(provider.confirmPaymentReservation).not.toHaveBeenCalled();
        });
    });

    describe('confirmPayment', () => {
        it('calls the provider when status is CREATED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.CREATED);
            await inTenant(async () => await paymentService.confirmPayment(payment));
            expect(provider.confirmPayment).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already PAID', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.PAID);
            await inTenant(async () => await paymentService.confirmPayment(payment));
            expect(provider.confirmPayment).not.toHaveBeenCalled();
        });

        it('throws for any other status', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.CANCELLED);
            await expect(inTenant(async () => await paymentService.confirmPayment(payment))).rejects.toThrow(/Cannot confirm payment/);
        });
    });

    describe('collectPaymentFromReservation', () => {
        it('calls the provider when status is RESERVED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.RESERVED);
            await inTenant(async () => await paymentService.collectPaymentFromReservation(payment));
            expect(provider.collectPaymentFromReservation).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already PAID', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.PAID);
            await inTenant(async () => await paymentService.collectPaymentFromReservation(payment));
            expect(provider.collectPaymentFromReservation).not.toHaveBeenCalled();
        });

        it('throws for any other status', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.CREATED);
            await expect(inTenant(async () => await paymentService.collectPaymentFromReservation(payment))).rejects.toThrow(/Can only collect/);
        });
    });

    describe('cancelPayment', () => {
        it('calls the provider when status is CREATED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.CREATED);
            await inTenant(async () => await paymentService.cancelPayment(payment));
            expect(provider.cancelPayment).toHaveBeenCalledTimes(1);
        });

        it('calls the provider when status is RESERVED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.RESERVED);
            await inTenant(async () => await paymentService.cancelPayment(payment));
            expect(provider.cancelPayment).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already CANCELLED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.CANCELLED);
            await inTenant(async () => await paymentService.cancelPayment(payment));
            expect(provider.cancelPayment).not.toHaveBeenCalled();
        });

        it('throws when the payment is already PAID (fully captured)', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.PAID);
            await expect(inTenant(async () => await paymentService.cancelPayment(payment))).rejects.toThrow(/Cannot cancel payment/);
        });
    });

    describe('refundPayment', () => {
        it('calls the provider when status is PAID', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.PAID);
            await inTenant(async () => await paymentService.refundPayment(payment));
            expect(provider.refundPayment).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already REFUNDED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.REFUNDED);
            await inTenant(async () => await paymentService.refundPayment(payment));
            expect(provider.refundPayment).not.toHaveBeenCalled();
        });

        it('throws for a non-PAID status', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = await createPayment(PaymentStatus.CREATED);
            await expect(inTenant(async () => await paymentService.refundPayment(payment))).rejects.toThrow(/Cannot refund payment/);
        });
    });
});