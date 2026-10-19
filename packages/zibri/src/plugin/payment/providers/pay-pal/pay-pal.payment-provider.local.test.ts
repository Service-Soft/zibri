import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { PayPalPaymentProvider, PayPalPaymentProviderPaymentData } from './pay-pal.payment-provider';
import { LocalPayPalCall, LocalPayPalServer } from '../../../../__testing__/local-pay-pal-server';
import { defaultTestServerEntities } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../data-source/repository/repository';
import { UniqueConstraintViolationError } from '../../../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { BadRequestError } from '../../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../../error-handling/errors/conflict.error';
import { type TenantServiceInterface } from '../../../../tenancy/tenant-service.interface';
import { JsonUtilities } from '../../../../utilities/json.utilities';
import { BigNumber, NumberUtilities } from '../../../../utilities/number.utilities';
import { UUIDUtilities } from '../../../../utilities/uuid.utilities';
import { KnownPaymentMethod, PaymentMethod } from '../../models/payment-method.model';
import { PaymentPluginOptionsInput } from '../../models/payment-plugin-options-input.model';
import { PaymentStatus } from '../../models/payment-status.enum';
import { Payment } from '../../models/payment.model';
import { ZibriPaymentPlugin } from '../../payment.plugin';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from '../../payment.tokens';
import { PaymentServiceInterface } from '../../services/payment-service.interface';

const localPayPal: LocalPayPalServer = new LocalPayPalServer();
let localPayPalUrl: string;

/**
 * The PayPal provider, talking to the local PayPal instead of the sandbox.
 */
class LocalPayPalPaymentProvider extends PayPalPaymentProvider {
    protected override get apiUrl(): string {
        return localPayPalUrl;
    }
}

type PayPalPayment = Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData>;

let server: StartedTestServer | undefined;
let payments: PaymentServiceInterface<[KnownPaymentMethod.PAY_PAL], [PayPalPaymentProvider]>;
let repository: Repository<PayPalPayment>;
const tenantId: string = UUIDUtilities.generate();

/**
 * Runs work in the tenant the payments of this suite belong to.
 * @param work - The work.
 * @returns What the work returns.
 */
async function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

/**
 * Starts a payment, which the local PayPal serves as approved by its buyer.
 * @returns The payment.
 */
async function startPayment(): Promise<PayPalPayment> {
    return await inTenant(async () => await payments.startPayment(
        KnownPaymentMethod.PAY_PAL,
        { amount: NumberUtilities.new(10), currencyCode: 'EUR', transactionId: UUIDUtilities.generate() }
    ));
}

/**
 * The amount of the order PayPal was last asked to create.
 * @returns The amount, as it was sent.
 */
function lastOrderedAmount(): unknown {
    const order: LocalPayPalCall | undefined = localPayPal.calls.filter(call => call.route === 'POST /v2/checkout/orders').at(-1);
    const body: { purchase_units: { amount: unknown }[] } = JsonUtilities.parse(order?.body ?? '{}');
    return body.purchase_units[0]?.amount;
}

describe('the PayPal provider, against a PayPal that behaves like one around a capture', () => {
    beforeAll(async () => {
        localPayPalUrl = await localPayPal.start();
        server = await startTestServer({
            plugins: [new ZibriPaymentPlugin()],
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Payment] })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                    useFactory: () => {
                        const res: PaymentPluginOptionsInput<[KnownPaymentMethod.PAY_PAL], [PayPalPaymentProvider]> = {
                            paymentMethods: [KnownPaymentMethod.PAY_PAL],
                            paymentProviders: [new LocalPayPalPaymentProvider('PayPal', { clientId: 'id', clientSecret: 'secret', env: 'sandbox' })],
                            providerNameForMethod: { [KnownPaymentMethod.PAY_PAL]: 'PayPal' }
                        };
                        return res as PaymentPluginOptionsInput<PaymentMethod[], DefaultPaymentProviderArray>;
                    }
                })
            ]
        });
        // eslint-disable-next-line typescript/no-unsafe-assignment
        payments = inject(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.PAYMENT_SERVICE);
        repository = inject(repositoryTokenFor(Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData>));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
        await localPayPal.stop();
    }, 15000);

    beforeEach(() => {
        localPayPal.losesCaptureAnswers = false;
        localPayPal.failsOrderLookups = false;
    });

    it('captures once when two confirmations of a payment run at once, and records it as paid', async () => {
        const payment: PayPalPayment = await startPayment();
        const capturesBefore: number = localPayPal.countCalls('POST /v2/checkout/orders/:id/capture');

        // a double click, a retried request, two replicas: each holds its own copy saying CREATED
        await inTenant(async () => await Promise.all([payments.confirmPayment({ ...payment }), payments.confirmPayment({ ...payment })]));

        expect(localPayPal.countCalls('POST /v2/checkout/orders/:id/capture') - capturesBefore).toBe(1);
        expect((await inTenant(async () => await repository.findById(payment.id))).status).toBe(PaymentStatus.PAID);
    });

    it('records a payment PayPal captured as paid when the answer to the capture is lost', async () => {
        const payment: PayPalPayment = await startPayment();
        localPayPal.losesCaptureAnswers = true;

        await inTenant(async () => await payments.confirmPayment(payment));

        const stored: PayPalPayment = await inTenant(async () => await repository.findById(payment.id));
        expect(stored.status).toBe(PaymentStatus.PAID);
        expect(stored.data?.captureId).toBeDefined();
    });

    it('leaves a payment as it was and says so when what PayPal did cannot be learned', async () => {
        const payment: PayPalPayment = await startPayment();
        localPayPal.losesCaptureAnswers = true;
        localPayPal.failsOrderLookups = true;

        await expect(inTenant(async () => await payments.confirmPayment(payment))).rejects.toThrow();

        // not FAILED, which nothing can be confirmed from again: the capture may well have happened
        expect((await inTenant(async () => await repository.findById(payment.id))).status).toBe(PaymentStatus.CREATED);
    });

    it('sends every call that moves money with an idempotency key', async () => {
        const payment: PayPalPayment = await startPayment();

        await inTenant(async () => await payments.confirmPayment(payment));

        const captures: (string | undefined)[] = localPayPal.calls
            .filter(call => call.route === `POST /v2/checkout/orders/${payment.data?.orderId}/capture`)
            .map(call => call.requestId);
        expect(captures).toHaveLength(1);
        expect(captures[0]).toBeDefined();
    });

    it('refuses a transition the stored payment does not allow, whatever the copy it is handed says', async () => {
        const payment: PayPalPayment = await startPayment();
        // cancelled through another copy, the way another request or replica would
        await inTenant(async () => await payments.cancelPayment({ ...payment }));
        const capturesBefore: number = localPayPal.countCalls('POST /v2/checkout/orders/:id/capture');

        // the caller's copy still says CREATED
        await expect(inTenant(async () => await payments.confirmPayment(payment))).rejects.toThrow(ConflictError);
        expect(localPayPal.countCalls('POST /v2/checkout/orders/:id/capture')).toBe(capturesBefore);
    });

    it('refuses a repeated transactionId before PayPal has an order for it', async () => {
        const transactionId: string = UUIDUtilities.generate();
        const start: () => Promise<PayPalPayment> = async () => await inTenant(async () => await payments.startPayment(
            KnownPaymentMethod.PAY_PAL,
            { amount: NumberUtilities.new(10), currencyCode: 'EUR', transactionId }
        ));
        await start();
        const ordersBefore: number = localPayPal.countCalls('POST /v2/checkout/orders');

        await expect(start()).rejects.toThrow(UniqueConstraintViolationError);
        expect(localPayPal.countCalls('POST /v2/checkout/orders')).toBe(ordersBefore);
    });

    it('refuses payment data a caller got wrong as a bad request', async () => {
        await expect(inTenant(async () => await payments.validatePaymentData(
            KnownPaymentMethod.PAY_PAL,
            { amount: NumberUtilities.new(0), currencyCode: 'EUR', transactionId: UUIDUtilities.generate() }
        ))).rejects.toThrow(BadRequestError);
    });

    it('refuses a transactionId the tenant already paid with as a conflict', async () => {
        const payment: PayPalPayment = await startPayment();

        await expect(inTenant(async () => await payments.validatePaymentData(
            KnownPaymentMethod.PAY_PAL,
            { amount: NumberUtilities.new(10), currencyCode: 'EUR', transactionId: payment.transactionId }
        ))).rejects.toThrow(ConflictError);
    });

    it('sends PayPal the amount exactly, in the decimals of its currency, and stores it exactly', async () => {
        // what a double makes of it is 0.30000000000000004
        const amount: BigNumber = NumberUtilities.add(new BigNumber('0.1'), new BigNumber('0.2'));

        const payment: PayPalPayment = await inTenant(async () => await payments.startPayment(
            KnownPaymentMethod.PAY_PAL,
            { amount, currencyCode: 'EUR', transactionId: UUIDUtilities.generate() }
        ));

        expect(lastOrderedAmount()).toEqual({ value: '0.30', currency_code: 'EUR' });
        expect((await inTenant(async () => await repository.findById(payment.id))).amount.toFixed()).toBe('0.3');
    });

    it('sends an amount in a currency without decimals as a whole number', async () => {
        await inTenant(async () => await payments.startPayment(
            KnownPaymentMethod.PAY_PAL,
            { amount: new BigNumber('1500'), currencyCode: 'JPY', transactionId: UUIDUtilities.generate() }
        ));

        expect(lastOrderedAmount()).toEqual({ value: '1500', currency_code: 'JPY' });
    });

    it('refuses an amount with more decimals than its currency has as a bad request', async () => {
        await expect(inTenant(async () => await payments.validatePaymentData(
            KnownPaymentMethod.PAY_PAL,
            { amount: new BigNumber('10.001'), currencyCode: 'EUR', transactionId: UUIDUtilities.generate() }
        ))).rejects.toThrow(BadRequestError);
        await expect(inTenant(async () => await payments.validatePaymentData(
            KnownPaymentMethod.PAY_PAL,
            { amount: new BigNumber('1500.5'), currencyCode: 'JPY', transactionId: UUIDUtilities.generate() }
        ))).rejects.toThrow(BadRequestError);
        // and one too small to be a single cent, which a double writes as 1e-7
        await expect(inTenant(async () => await payments.validatePaymentData(
            KnownPaymentMethod.PAY_PAL,
            { amount: new BigNumber('0.0000001'), currencyCode: 'EUR', transactionId: UUIDUtilities.generate() }
        ))).rejects.toThrow(BadRequestError);
    });
});