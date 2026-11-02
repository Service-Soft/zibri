import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { KnownPaymentMethod, PaymentMethod } from './models/payment-method.model';
import { PaymentPluginOptionsInput } from './models/payment-plugin-options-input.model';
import { PaymentStatus } from './models/payment-status.enum';
import { Payment } from './models/payment.model';
import { PaymentReconciliationCronJob } from './payment-reconciliation.cron-job';
import { ZibriPaymentPlugin } from './payment.plugin';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from './payment.tokens';
import { PayPalPaymentProvider, PayPalPaymentProviderPaymentData } from './providers/pay-pal/pay-pal.payment-provider';
import { PaymentServiceInterface } from './services/payment-service.interface';
import { TestTimeouts } from '../../__testing__/constants';
import { LocalPayPalServer } from '../../__testing__/local-pay-pal-server';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { CronJobEntity } from '../../cron/cron-job-entity.model';
import { Repository } from '../../data-source/repository/repository';
import { UniqueConstraintViolationError } from '../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Ms } from '../../utilities/ms';
import { NumberUtilities } from '../../utilities/number.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

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

const plugin: ZibriPaymentPlugin = new ZibriPaymentPlugin();
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
 * Starts a payment, and dates it back by the given time.
 * @param ageInMs - How long ago it was started.
 * @returns The payment.
 */
async function requestPaymentStartedAgo(ageInMs: number): Promise<PayPalPayment> {
    return await inTenant(async () => {
        const payment: PayPalPayment = await payments.requestPayment(
            KnownPaymentMethod.PAY_PAL,
            { amount: NumberUtilities.new(10), currencyCode: 'EUR', transactionId: UUIDUtilities.generate() }
        );
        return await repository.updateById(payment.id, { createdAt: new Date(Date.now() - ageInMs) });
    });
}

/**
 * Reads what a payment holds now.
 * @param payment - The payment.
 * @returns Its stored row.
 */
async function findStored(payment: PayPalPayment): Promise<PayPalPayment> {
    return await inTenant(async () => await repository.findById(payment.id));
}

/**
 * Runs the job once, built by hand, because the test server runs no cron jobs.
 */
async function runReconciliation(): Promise<void> {
    const job: PaymentReconciliationCronJob = new PaymentReconciliationCronJob();
    await job.init(inject(ZIBRI_DI_TOKENS.LOGGER), inject(repositoryTokenFor(CronJobEntity)), async () => await Promise.resolve(true));
    await job.onTick();
}

// a payment the buyer never approved stayed CREATED for good, with nothing asking
// PayPal what became of it
describe('PaymentReconciliationCronJob', () => {
    beforeAll(async () => {
        localPayPalUrl = await localPayPal.start();
        server = await startTestServer({
            plugins: [plugin],
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Payment], repositories: defaultTestServerRepositories })],
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
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
        await localPayPal.stop();
    }, TestTimeouts.inMemory.shutdown);

    beforeEach(() => {
        localPayPal.losesCaptureAnswers = false;
        localPayPal.failsOrderLookups = false;
    });

    it('is registered by the plugin', () => {
        expect(plugin.cronJobs).toContain(PaymentReconciliationCronJob);
    });

    it('cancels a payment its buyer never approved once the window to approve it has passed, and keeps its transactionId taken', async () => {
        const payment: PayPalPayment = await requestPaymentStartedAgo(2 * Ms.DAY);

        await runReconciliation();

        expect((await findStored(payment)).status).toBe(PaymentStatus.CANCELLED);
        await expect(inTenant(async () => await payments.requestPayment(
            KnownPaymentMethod.PAY_PAL,
            { amount: NumberUtilities.new(10), currencyCode: 'EUR', transactionId: payment.transactionId }
        ))).rejects.toThrow(UniqueConstraintViolationError);
    });

    it('records a payment PayPal captured as paid, though the application never learned it was', async () => {
        const payment: PayPalPayment = await requestPaymentStartedAgo(2 * Ms.DAY);
        // captured at PayPal, and neither the answer nor a lookup reached the application
        localPayPal.losesCaptureAnswers = true;
        localPayPal.failsOrderLookups = true;
        await expect(inTenant(async () => await payments.confirmPayment(payment))).rejects.toThrow();
        localPayPal.losesCaptureAnswers = false;
        localPayPal.failsOrderLookups = false;
        expect((await findStored(payment)).status).toBe(PaymentStatus.CREATED);

        await runReconciliation();

        const stored: PayPalPayment = await findStored(payment);
        expect(stored.status).toBe(PaymentStatus.PAID);
        expect(stored.data?.captureId).toBeDefined();
    });

    it('leaves a payment whose buyer may still approve it, and does not ask PayPal about it', async () => {
        const payment: PayPalPayment = await requestPaymentStartedAgo(Ms.MINUTE);
        const lookupsBefore: number = localPayPal.countCalls(`GET /v2/checkout/orders/${payment.data?.orderId}`);

        await runReconciliation();

        expect((await findStored(payment)).status).toBe(PaymentStatus.CREATED);
        expect(localPayPal.countCalls(`GET /v2/checkout/orders/${payment.data?.orderId}`)).toBe(lookupsBefore);
    });

    it('leaves a payment as it is when PayPal cannot be asked, and says so', async () => {
        const payment: PayPalPayment = await requestPaymentStartedAgo(2 * Ms.DAY);
        localPayPal.failsOrderLookups = true;

        // thrown, so that the job's row records the failure
        await expect(runReconciliation()).rejects.toThrow('Could not reconcile 1 abandoned payments');

        expect((await findStored(payment)).status).toBe(PaymentStatus.CREATED);
    });
});