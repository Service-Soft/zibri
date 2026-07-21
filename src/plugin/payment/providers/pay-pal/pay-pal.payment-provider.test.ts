import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
// eslint-disable-next-line eslintImport/no-unassigned-import
import 'dotenv/config';
import { Browser, chromium, Page } from 'playwright';

import { PayPalPaymentData, PayPalPaymentProvider, PayPalPaymentProviderPaymentData, PayPalValidatedPaymentData } from './pay-pal.payment-provider';
import { testFileFolder } from '../../../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../data-source/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { isHttpClientError } from '../../../../http-client/http-client.error';
import { CurrencyCode } from '../../../../localization/models/currency-code.model';
import { FsPath, FsUtilities } from '../../../../utilities/fs.utilities';
import { UUIDUtilities } from '../../../../utilities/uuid.utilities';
import { KnownPaymentMethod, PaymentMethod } from '../../models/payment-method.model';
import { PaymentPluginOptionsInput } from '../../models/payment-plugin-options-input.model';
import { PaymentStatus } from '../../models/payment-status.enum';
import { Payment } from '../../models/payment.model';
import { ZibriPaymentPlugin } from '../../payment.plugin';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from '../../payment.tokens';
import { PaymentServiceInterface } from '../../services/payment-service.interface';

const testDir: FsPath = FsUtilities.getPath(testFileFolder, 'pay-pal-payment-provider');

/**
 * Actually approves a PayPal sandbox order as the buyer.
 *
 * PayPal's Orders API has no server-to-server way to move an order from `PAYER_ACTION_REQUIRED` to
 * `APPROVED` — that can only happen via the buyer going through PayPal's hosted checkout UI. This drives
 * that UI with a real (headless) browser, logging in as the PAYPAL_BUYER_EMAIL/PAYPAL_BUYER_PASSWORD
 * sandbox account and approving the payment.
 * @param approvalUrl - The `rel: "payer-action"` link returned when the order was created.
 * @param buyerEmail - The email of the PayPal sandbox buyer account to log in as.
 * @param buyerPassword - The password of the PayPal sandbox buyer account to log in as.
 */
async function simulateBuyerApproval(approvalUrl: string, buyerEmail: string, buyerPassword: string): Promise<void> {
    const browser: Browser = await chromium.launch();
    // Declared outside the try block so the catch handler below can still capture diagnostics from it.
    let page: Page | undefined;
    try {
        // PayPal's checkout UI locale is driven by the visitor's geolocation, not just Accept-Language/query
        // params — both are set here as a best-effort hint, but the login step is the one that reliably obeys it.
        page = await browser.newPage({ locale: 'en-US', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } });
        await page.goto(`${approvalUrl}&locale.x=en_US`);

        await page.getByLabel(/email or mobile number/i).fill(buyerEmail);
        await page.getByRole('button', { name: /^next$/i }).click();

        await page.getByLabel(/^password$/i).fill(buyerPassword);
        await page.getByRole('button', { name: /log in/i }).click();

        // The post-login order review page reverts to a geolocation-based locale, so this is targeted by its
        // (language-independent) data-testid rather than by button text.
        await page.locator('[data-testid="submit-button-initial"]').click();

        // The redirect target (URLS.returnUrl) is a fake domain, so just wait until PayPal navigates away.
        await page.waitForURL(url => !url.hostname.endsWith('paypal.com'), { timeout: 20000 });
    }
    catch (error) {
        if (page) {
            await page.screenshot({
                path: `${testDir}/paypal-stuck.png`,
                fullPage: true
            });
            await FsUtilities.upsertFile(
                FsUtilities.getPath(`${testDir}/paypal-stuck.html`),
                await page.content()
            );
        }
        throw new Error(`Buyer approval via browser automation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        await browser.close();
    }
}

// ── Test suite ────────────────────────────────────────────────────────────────

const clientId: string | undefined = process.env['PAYPAL_CLIENT_ID'];

const clientSecret: string | undefined = process.env['PAYPAL_CLIENT_SECRET'];
const buyerEmail: string | undefined = process.env['PAYPAL_BUYER_EMAIL'];
const buyerPassword: string | undefined = process.env['PAYPAL_BUYER_PASSWORD'];
const hasSandboxCredentials: boolean = Boolean(clientId && clientSecret && buyerEmail && buyerPassword);

// Runs real transactions against the PayPal sandbox API and drives a real browser through PayPal's hosted
// checkout, so it needs PAYPAL_CLIENT_ID/CLIENT_SECRET/BUYER_EMAIL/BUYER_PASSWORD in the environment (eg. via
// .env). Skips gracefully instead of failing when those aren't available, eg. in CI environments without them.
(hasSandboxCredentials ? describe : describe.skip)('PayPalPaymentProvider (sandbox)', () => {
    let paymentService: PaymentServiceInterface<[KnownPaymentMethod.PAY_PAL], [PayPalPaymentProvider]>;
    let paymentRepository: Repository<Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData>>;

    let testServer: StartedTestServer;

    const METHOD: KnownPaymentMethod = KnownPaymentMethod.PAY_PAL;
    const AMOUNT: number = 9.99;
    const CURRENCY: CurrencyCode = 'EUR';
    const URLS: Required<Pick<PayPalPaymentData, 'cancelUrl' | 'returnUrl'>> = { returnUrl: 'https://example.com/return', cancelUrl: 'https://example.com/cancel' };

    beforeAll(async () => {
        assert(clientId && clientSecret && buyerEmail && buyerPassword);

        testServer = await startTestServer({
            plugins: [new ZibriPaymentPlugin()],
            dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, Payment] })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
                    useFactory: () => {
                        const res: PaymentPluginOptionsInput<
                            [KnownPaymentMethod.PAY_PAL],
                            [PayPalPaymentProvider]
                        > = {
                            paymentMethods: [KnownPaymentMethod.PAY_PAL],
                            paymentProviders: [
                                new PayPalPaymentProvider('PayPal', {
                                    clientId,
                                    clientSecret,
                                    env: 'sandbox'
                                })
                            ],
                            providerNameForMethod: {
                                [KnownPaymentMethod.PAY_PAL]: 'PayPal'
                            }
                        };
                        return res as PaymentPluginOptionsInput<PaymentMethod[], DefaultPaymentProviderArray>;
                    }
                })
            ]
        });
        paymentService = inject<PaymentServiceInterface<[KnownPaymentMethod.PAY_PAL], [PayPalPaymentProvider]>>(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.PAYMENT_SERVICE);
        paymentRepository = inject(repositoryTokenFor(Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData>));
    }, 20000);

    afterAll(async () => {
        await testServer.shutdown();
    }, 15000);

    describe('validatePaymentData', () => {
        it('accepts valid data', async () => {
            await expect(
                paymentService.validatePaymentData(METHOD, { amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate() })
            ).resolves.toBeDefined();
        });

        it('rejects amount <= 0', async () => {
            await expect(
                paymentService.validatePaymentData(METHOD, { amount: 0, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate() })
            ).rejects.toThrow('amount must be > 0');
        });

        it('rejects missing currencyCode', async () => {
            await expect(
                paymentService.validatePaymentData(METHOD, { amount: AMOUNT, currencyCode: '' as 'EUR', transactionId: UUIDUtilities.generate() })
            ).rejects.toThrow('currencyCode required');
        });
    });

    // ── Direct payment: startPayment → confirmPayment ───────────────────────

    describe('startPayment + confirmPayment', () => {
        it('creates a CAPTURE-intent order and captures it after buyer approval', async () => {
            const data: PayPalValidatedPaymentData = await paymentService.validatePaymentData(METHOD, {
                amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate(), ...URLS
            });

            const payment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentService.startPayment(METHOD, data);

            expect(payment.status).toBe(PaymentStatus.CREATED);
            expect(payment.data?.orderId).toBeTruthy();
            expect(payment.data?.approvalUrl).toMatch(/paypal\.com/);

            assert(payment.data?.orderId && payment.data.approvalUrl && buyerEmail && buyerPassword);

            await simulateBuyerApproval(payment.data.approvalUrl, buyerEmail, buyerPassword);
            await paymentService.confirmPayment(payment);

            const confirmedPayment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentRepository.findById(payment.id);
            if (isHttpClientError(confirmedPayment.error)) {
                // eslint-disable-next-line no-console
                console.debug(
                    'confirmedPayment.error:\n',
                    confirmedPayment.error.message,
                    '\nresponseData.body:\n',
                    JSON.stringify(confirmedPayment.error.responseData?.body, undefined, 2)
                );
            }
            else if (confirmedPayment.error) {
                // eslint-disable-next-line no-console
                console.debug('confirmedPayment.error (non-HttpClientError):\n', confirmedPayment.error);
            }

            expect(confirmedPayment.status).toBe(PaymentStatus.PAID);
            expect(confirmedPayment.data?.captureId).toBeTruthy();
            // Re-fetched from the database, so a cleared error column comes back as null, not undefined.
            expect(confirmedPayment.error).toBeFalsy();
        }, 60000);
    });

    // ── Cancel before buyer approves ────────────────────────────────────────

    describe('cancelPayment (status: CREATED)', () => {
        it('cancels locally without calling PayPal when the order was never approved', async () => {
            const data: PayPalValidatedPaymentData = await paymentService.validatePaymentData(METHOD, {
                amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate()
            });

            const payment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentService.startPayment(METHOD, data);
            expect(payment.status).toBe(PaymentStatus.CREATED);

            await paymentService.cancelPayment(payment);

            expect(payment.status).toBe(PaymentStatus.CANCELLED);
            expect(payment.error).toBeFalsy();
            // no PayPal call needed — just a local state change
        });
    });

    // ── Reservation: startPaymentReservation → confirmPaymentReservation
    //                → collectPaymentFromReservation ─────────────────────────

    describe('startPaymentReservation + confirmPaymentReservation + collectPaymentFromReservation', () => {
        it('creates an AUTHORIZE-intent order, reserves funds, then collects payment', async () => {
            const data: PayPalValidatedPaymentData = await paymentService.validatePaymentData(METHOD, {
                amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate(), ...URLS
            });

            const payment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentService.startPaymentReservation(METHOD, data);

            expect(payment.status).toBe(PaymentStatus.CREATED);
            expect(payment.data?.orderId).toBeTruthy();

            assert(payment.data?.orderId && payment.data.approvalUrl && buyerEmail && buyerPassword);

            // Simulate buyer completing the approval redirect
            await simulateBuyerApproval(payment.data.approvalUrl, buyerEmail, buyerPassword);

            // confirmPaymentReservation must call POST .../authorize (the BUG-2 fix)
            await paymentService.confirmPaymentReservation(payment);

            expect(payment.status).toBe(PaymentStatus.RESERVED);
            expect(payment.data.authorizationId).toBeTruthy();
            expect(payment.error).toBeFalsy();

            // Collect the reserved funds
            await paymentService.collectPaymentFromReservation(payment);

            expect(payment.status).toBe(PaymentStatus.PAID);
            expect(payment.data.captureId).toBeTruthy();
            expect(payment.error).toBeFalsy();
        }, 60000);
    });

    // ── Cancel a reserved authorization (void) ──────────────────────────────

    describe('cancelPayment (status: RESERVED)', () => {
        it('voids the PayPal authorization and marks payment as CANCELLED', async () => {
            const data: PayPalValidatedPaymentData = await paymentService.validatePaymentData(METHOD, {
                amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate(), ...URLS
            });

            const payment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentService.startPaymentReservation(METHOD, data);

            assert(payment.data?.orderId && payment.data.approvalUrl && buyerEmail && buyerPassword);
            await simulateBuyerApproval(payment.data.approvalUrl, buyerEmail, buyerPassword);
            await paymentService.confirmPaymentReservation(payment);

            expect(payment.status).toBe(PaymentStatus.RESERVED);

            await paymentService.cancelPayment(payment);

            expect(payment.status).toBe(PaymentStatus.CANCELLED);
            expect(payment.error).toBeFalsy();
        }, 60000);
    });

    // ── Refund ──────────────────────────────────────────────────────────────

    describe('refundPayment', () => {
        it('refunds a captured payment and marks it REFUNDED', async () => {
            const data: PayPalValidatedPaymentData = await paymentService.validatePaymentData(METHOD, {
                amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate(), ...URLS
            });

            const payment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentService.startPayment(METHOD, data);

            assert(payment.data?.orderId && payment.data.approvalUrl && buyerEmail && buyerPassword);
            await simulateBuyerApproval(payment.data.approvalUrl, buyerEmail, buyerPassword);
            await paymentService.confirmPayment(payment);

            expect(payment.status).toBe(PaymentStatus.PAID);

            await paymentService.refundPayment(payment);

            expect(payment.status).toBe(PaymentStatus.REFUNDED);
            expect(payment.error).toBeFalsy();
        }, 60000);
    });
});