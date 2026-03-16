import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
// eslint-disable-next-line eslintImport/no-unassigned-import
import 'dotenv/config';

import { PayPalPaymentData, PayPalPaymentProvider, PayPalPaymentProviderPaymentData, PayPalValidatedPaymentData } from './pay-pal.payment-provider';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../../../data-source/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../../di/inject.function';
import { defineProvider } from '../../../../di/models/di-provider.model';
import { isHttpClientError } from '../../../../http-client/http-client.error';
import { CurrencyCode } from '../../../../localization/models/currency-code.model';
import { UUIDUtilities } from '../../../../utilities/uuid.utilities';
import { KnownPaymentMethod, PaymentMethod } from '../../models/payment-method.model';
import { PaymentPluginOptionsInput } from '../../models/payment-plugin-options-input.model';
import { PaymentStatus } from '../../models/payment-status.enum';
import { Payment } from '../../models/payment.model';
import { ZibriPaymentPlugin } from '../../payment.plugin';
import { DefaultPaymentProviderArray, ZIBRI_PAYMENT_DI_TOKENS } from '../../payment.tokens';
import { PaymentServiceInterface } from '../../services/payment-service.interface';

async function getSandboxToken(clientId: string, clientSecret: string): Promise<string> {
    const auth: string = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res: Response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
        method: 'POST',
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    if (!res.ok) {
        throw new Error(`Sandbox auth failed: ${await res.text()}`);
    }
    const { access_token } = await res.json() as { access_token: string };
    return access_token;
}

// TODO: this currently doesn't work.
async function simulateBuyerApproval(merchantToken: string, orderId: string, returnUrl: string, cancelUrl: string): Promise<void> {
    const res: Response = await fetch(
        `https://api-m.sandbox.paypal.com/v2/checkout/orders/${orderId}/confirm-payment-source`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${merchantToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                payment_source: {
                    // eslint-disable-next-line cspell/spellchecker
                    paypal: {
                        experience_context: {
                            payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
                            return_url: returnUrl,
                            cancel_url: cancelUrl
                        }
                    }
                }
            })
        }
    );

    const body: string = await res.text();
    // eslint-disable-next-line no-console
    console.debug('simulateBuyerApproval', { ok: res.ok, status: res.status, body });
    if (!res.ok) {
        throw new Error(`Buyer approval failed (${res.status}): ${body}`);
    }
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('PayPalPaymentProvider (sandbox)', () => {
    let paymentService: PaymentServiceInterface<[KnownPaymentMethod.PAY_PAL], [PayPalPaymentProvider]>;
    let paymentRepository: Repository<Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData>>;

    let sandboxToken: string;
    let testServer: StartedPostgreSqlContainer;

    // eslint-disable-next-line cspell/spellchecker
    const clientId: string | undefined = process.env['PAYPAL_CLIENT_ID'];
    // eslint-disable-next-line cspell/spellchecker
    const clientSecret: string | undefined = process.env['PAYPAL_CLIENT_SECRET'];

    if (!clientId || !clientSecret) {
        throw new Error('clientId or clientSecret not available');
    }

    const METHOD: KnownPaymentMethod = KnownPaymentMethod.PAY_PAL;
    const AMOUNT: number = 9.99;
    const CURRENCY: CurrencyCode = 'EUR';
    const URLS: Required<Pick<PayPalPaymentData, 'cancelUrl' | 'returnUrl'>> = { returnUrl: 'https://example.com/return', cancelUrl: 'https://example.com/cancel' };

    beforeAll(async () => {
        testServer = await startTestServer({
            plugins: [new ZibriPaymentPlugin()],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_PAYMENT_DI_TOKENS.OPTIONS_INPUT,
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
        paymentService = inject<PaymentServiceInterface<[KnownPaymentMethod.PAY_PAL], [PayPalPaymentProvider]>>(ZIBRI_PAYMENT_DI_TOKENS.PAYMENT_SERVICE);
        paymentRepository = inject(repositoryTokenFor(Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData>));
        sandboxToken = await getSandboxToken(clientId, clientSecret);
    });

    afterAll(async () => {
        await testServer.stop();
    });

    describe('validatePaymentData', () => {
        it('accepts valid data', () => {
            expect(() => paymentService.validatePaymentData(METHOD, { amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate() })).not.toThrow();
        });

        it('rejects amount <= 0', () => {
            expect(() => paymentService.validatePaymentData(METHOD, { amount: 0, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate() })).toThrow('amount must be > 0');
        });

        it('rejects missing currencyCode', () => {
            expect(() => paymentService.validatePaymentData(METHOD, { amount: AMOUNT, currencyCode: '', transactionId: UUIDUtilities.generate() })).toThrow('currencyCode required');
        });
    });

    // ── Direct payment: startPayment → confirmPayment ───────────────────────

    describe.only('startPayment + confirmPayment', () => {
        it.only('creates a CAPTURE-intent order and captures it after buyer approval', async () => {
            const data: PayPalValidatedPaymentData = await paymentService.validatePaymentData(METHOD, {
                amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate(), ...URLS
            });

            const payment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentService.startPayment(METHOD, data);

            expect(payment.status).toBe(PaymentStatus.CREATED);
            expect(payment.data?.orderId).toBeTruthy();
            expect(payment.data?.approvalUrl).toMatch(/paypal\.com/);

            assert(payment.data?.orderId);

            await simulateBuyerApproval(sandboxToken, payment.data.orderId, URLS.returnUrl, URLS.cancelUrl);
            await paymentService.confirmPayment(payment);

            const confirmedPayment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentRepository.findById(payment.id);
            if (isHttpClientError(confirmedPayment.error)) {
                // eslint-disable-next-line no-console
                console.debug('confirmedPayment.error.responseData.body:\n', confirmedPayment.error.responseData?.body);
            }

            expect(confirmedPayment.status).toBe(PaymentStatus.PAID);
            expect(confirmedPayment.data?.captureId).toBeTruthy();
            expect(confirmedPayment.error).toBeUndefined();
        });
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
            expect(payment.error).toBeUndefined();
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

            assert(payment.data?.orderId);

            // Simulate buyer completing the approval redirect
            await simulateBuyerApproval(sandboxToken, payment.data.orderId, URLS.returnUrl, URLS.cancelUrl);

            // confirmPaymentReservation must call POST .../authorize (the BUG-2 fix)
            await paymentService.confirmPaymentReservation(payment);

            expect(payment.status).toBe(PaymentStatus.RESERVED);
            expect(payment.data.authorizationId).toBeTruthy();
            expect(payment.error).toBeUndefined();

            // Collect the reserved funds
            await paymentService.collectPaymentFromReservation(payment);

            expect(payment.status).toBe(PaymentStatus.PAID);
            expect(payment.data.captureId).toBeTruthy();
            expect(payment.error).toBeUndefined();
        });
    });

    // ── Cancel a reserved authorization (void) ──────────────────────────────

    describe('cancelPayment (status: RESERVED)', () => {
        it('voids the PayPal authorization and marks payment as CANCELLED', async () => {
            const data: PayPalValidatedPaymentData = await paymentService.validatePaymentData(METHOD, {
                amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate(), ...URLS
            });

            const payment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentService.startPaymentReservation(METHOD, data);

            assert(payment.data?.orderId);
            await simulateBuyerApproval(sandboxToken, payment.data.orderId, URLS.returnUrl, URLS.cancelUrl);
            await paymentService.confirmPaymentReservation(payment);

            expect(payment.status).toBe(PaymentStatus.RESERVED);

            await paymentService.cancelPayment(payment);

            expect(payment.status).toBe(PaymentStatus.CANCELLED);
            expect(payment.error).toBeUndefined();
        });
    });

    // ── Refund ──────────────────────────────────────────────────────────────

    describe('refundPayment', () => {
        it('refunds a captured payment and marks it REFUNDED', async () => {
            const data: PayPalValidatedPaymentData = await paymentService.validatePaymentData(METHOD, {
                amount: AMOUNT, currencyCode: CURRENCY, transactionId: UUIDUtilities.generate(), ...URLS
            });

            const payment: Payment<KnownPaymentMethod.PAY_PAL, PayPalPaymentProviderPaymentData> = await paymentService.startPayment(METHOD, data);

            assert(payment.data?.orderId);
            await simulateBuyerApproval(sandboxToken, payment.data.orderId, URLS.returnUrl, URLS.cancelUrl);
            await paymentService.confirmPayment(payment);

            expect(payment.status).toBe(PaymentStatus.PAID);

            await paymentService.refundPayment(payment);

            expect(payment.status).toBe(PaymentStatus.REFUNDED);
            expect(payment.error).toBeUndefined();
        });
    });
});