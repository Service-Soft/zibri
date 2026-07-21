import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { PaymentServiceInterface } from './payment-service.interface';
import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../data-source/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
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

function createPayment(status: PaymentStatus): Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> {
    return {
        id: UUIDUtilities.generate(),
        transactionId: UUIDUtilities.generate(),
        createdAt: new Date(),
        status,
        amount: 10,
        currencyCode: 'EUR',
        paymentMethod: KnownPaymentMethod.PAY_PAL,
        data: undefined,
        error: undefined
    };
}

describe('PaymentService', () => {
    let server: StartedTestServer;
    let paymentService: PaymentServiceInterface<[KnownPaymentMethod.PAY_PAL], [AnyPaymentProviderInterface]>;
    let paymentRepository: Repository<Payment<KnownPaymentMethod, Record<string, unknown>>>;
    let provider: ReturnType<typeof createFakeProvider>;

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
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('validatePaymentData', () => {
        it('rejects a duplicate transactionId', async () => {
            const transactionId: string = UUIDUtilities.generate();
            await paymentRepository.create({
                transactionId,
                status: PaymentStatus.CREATED,
                amount: 1,
                currencyCode: 'EUR',
                paymentMethod: KnownPaymentMethod.PAY_PAL
            });

            await expect(
                paymentService.validatePaymentData(KnownPaymentMethod.PAY_PAL, { transactionId, amount: 1, currencyCode: 'EUR' })
            ).rejects.toThrow(/already exists/);
        });
    });

    describe('confirmPaymentReservation', () => {
        it('calls the provider when status is CREATED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.CREATED);
            await paymentService.confirmPaymentReservation(payment);
            expect(provider.confirmPaymentReservation).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already RESERVED', async () => {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            // eslint-disable-next-line typescript/typedef
            const warnSpy = jest.spyOn(logger, 'warn');
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.RESERVED);

            await paymentService.confirmPaymentReservation(payment);

            expect(provider.confirmPaymentReservation).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('throws for any other status', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.PAID);
            await expect(paymentService.confirmPaymentReservation(payment)).rejects.toThrow(/Cannot confirm payment/);
            expect(provider.confirmPaymentReservation).not.toHaveBeenCalled();
        });
    });

    describe('confirmPayment', () => {
        it('calls the provider when status is CREATED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.CREATED);
            await paymentService.confirmPayment(payment);
            expect(provider.confirmPayment).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already PAID', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.PAID);
            await paymentService.confirmPayment(payment);
            expect(provider.confirmPayment).not.toHaveBeenCalled();
        });

        it('throws for any other status', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.CANCELLED);
            await expect(paymentService.confirmPayment(payment)).rejects.toThrow(/Cannot confirm payment/);
        });
    });

    describe('collectPaymentFromReservation', () => {
        it('calls the provider when status is RESERVED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.RESERVED);
            await paymentService.collectPaymentFromReservation(payment);
            expect(provider.collectPaymentFromReservation).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already PAID', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.PAID);
            await paymentService.collectPaymentFromReservation(payment);
            expect(provider.collectPaymentFromReservation).not.toHaveBeenCalled();
        });

        it('throws for any other status', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.CREATED);
            await expect(paymentService.collectPaymentFromReservation(payment)).rejects.toThrow(/Can only collect/);
        });
    });

    describe('cancelPayment', () => {
        it('calls the provider when status is CREATED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.CREATED);
            await paymentService.cancelPayment(payment);
            expect(provider.cancelPayment).toHaveBeenCalledTimes(1);
        });

        it('calls the provider when status is RESERVED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.RESERVED);
            await paymentService.cancelPayment(payment);
            expect(provider.cancelPayment).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already CANCELLED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.CANCELLED);
            await paymentService.cancelPayment(payment);
            expect(provider.cancelPayment).not.toHaveBeenCalled();
        });

        it('throws when the payment is already PAID (fully captured)', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.PAID);
            await expect(paymentService.cancelPayment(payment)).rejects.toThrow(/Cannot cancel payment/);
        });
    });

    describe('refundPayment', () => {
        it('calls the provider when status is PAID', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.PAID);
            await paymentService.refundPayment(payment);
            expect(provider.refundPayment).toHaveBeenCalledTimes(1);
        });

        it('no-ops with a warning when already REFUNDED', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.REFUNDED);
            await paymentService.refundPayment(payment);
            expect(provider.refundPayment).not.toHaveBeenCalled();
        });

        it('throws for a non-PAID status', async () => {
            const payment: Payment<KnownPaymentMethod.PAY_PAL, Record<string, unknown>> = createPayment(PaymentStatus.CREATED);
            await expect(paymentService.refundPayment(payment)).rejects.toThrow(/Cannot refund payment/);
        });
    });
});