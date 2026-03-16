import { PaymentProviderInterface } from '../payment-provider.interface';
import { AuthorizationCaptureResp, CaptureOrderResp, GetOrderResp, PayPalCapture, PayPalClient, RefundCaptureResp } from './pay-pal-client';
import { Repository } from '../../../../data-source/repository';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../../di/inject.function';
import { KnownPaymentMethod } from '../../models/payment-method.model';
import { PaymentStatus } from '../../models/payment-status.enum';
import { Payment } from '../../models/payment.model';

/**
 * The environment of the pay-pal client.
 */
export type PayPalEnv = 'sandbox' | 'live';

/**
 * The supported methods of the PayPalPaymentProvider.
 */
type SupportedMethods = [KnownPaymentMethod.PAY_PAL];

/**
 * The data for creating a new payment.
 */
export type PayPalPaymentData = {
    /**
     * The amount of the payment.
     */
    amount: number,
    /**
     * The currency of the payment.
     */
    currencyCode: string,
    /**
     * The url to return to to confirm the payment.
     */
    returnUrl?: string,
    /**
     * The url to return to to cancel the payment.
     */
    cancelUrl?: string,
    /**
     * The transactionId, used to prevent duplicate payments.
     */
    transactionId: string
};

/**
 * The validated payment data.
 */
export type PayPalValidatedPaymentData = PayPalPaymentData;

/**
 * The payment data stored by the provider.
 */
export type PayPalPaymentProviderPaymentData = {
    /**
     * The id of the order.
     */
    orderId?: string,
    /**
     * The url to navigate to for approval.
     */
    approvalUrl?: string,
    /**
     * The id of the authorization.
     */
    authorizationId?: string,
    /**
     * The id of the payment capture.
     */
    captureId?: string,
    /**
     * The id of the refund.
     */
    refundId?: string
};

/**
 * The payment reservation data.
 */
type PayPalProviderReservationPaymentData = PayPalPaymentProviderPaymentData;

/**
 * Maps payment methods to their payment data.
 */
type PaymentDataMap = {
    /**
     * The payment data for the PayPal payment method.
     */
    PAY_PAL: PayPalPaymentData
};

/**
 * Maps payment methods to their validated payment data.
 */
type ValidatedPaymentDataMap = {
    /**
     * The validated payment data for the PayPal payment method.
     */
    PAY_PAL: PayPalValidatedPaymentData
};

/**
 * Maps payment methods to their provider payment data.
 */
type ProviderPaymentDataMap = {
    /**
     * The provider payment data for the PayPal payment method.
     */
    PAY_PAL: PayPalPaymentProviderPaymentData
};

/**
 * Maps payment methods to their provider reservation payment data.
 */
type ProviderReservationPaymentDataMap = {
    /**
     * The provider reservation payment data for the PayPal payment method.
     */
    PAY_PAL: PayPalProviderReservationPaymentData
};

/**
 * Defines whether a given method supports cancellation.
 */
type CancellationSupport = {
    /**
     * PayPal.
     */
    PAY_PAL: true
};

/**
 * Defines whether a given method supports refunding.
 */
type RefundSupport = {
    /**
     * PayPal.
     */
    PAY_PAL: true
};

/**
 * Defines whether a given method supports reservation.
 */
type ReservationSupport = {
    /**
     * PayPal.
     */
    PAY_PAL: true
};

/**
 * Options for configuring the PayPalPaymentProvider.
 */
export type PayPalPaymentProviderOptions = {
    /**
     * The clientId needed to authenticate with the api.
     */
    clientId: string,
    /**
     * The clientSecret needed to authenticate with the api.
     */
    clientSecret: string,
    /**
     * The PayPal environment, either 'sandbox' or 'live'.
     */
    env: PayPalEnv
};

/**
 * Payment Provider that uses the PayPal API.
 */
export class PayPalPaymentProvider implements PaymentProviderInterface<
    SupportedMethods,
    PaymentDataMap,
    ValidatedPaymentDataMap,
    ProviderPaymentDataMap,
    ProviderReservationPaymentDataMap,
    CancellationSupport,
    RefundSupport,
    ReservationSupport
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    declare readonly __supportedMethods: SupportedMethods;
    // eslint-disable-next-line jsdoc/require-jsdoc
    declare readonly __paymentDataMap: PaymentDataMap;
    // eslint-disable-next-line jsdoc/require-jsdoc
    declare readonly __validatedDataMap: ValidatedPaymentDataMap;
    // eslint-disable-next-line jsdoc/require-jsdoc
    declare readonly __providerPaymentDataMap: ProviderPaymentDataMap;
    // eslint-disable-next-line jsdoc/require-jsdoc
    declare readonly __providerReservationPaymentDataMap: ProviderReservationPaymentDataMap;
    // eslint-disable-next-line jsdoc/require-jsdoc
    declare readonly __cancellationSupportMap: CancellationSupport;
    // eslint-disable-next-line jsdoc/require-jsdoc
    declare readonly __refundSupportMap: RefundSupport;
    // eslint-disable-next-line jsdoc/require-jsdoc
    declare readonly __reservationSupportMap: ReservationSupport;

    /**
     * Client that encapsulates the PayPal API.
     */
    protected readonly client: PayPalClient;

    constructor(
        readonly name: string,
        options: PayPalPaymentProviderOptions
    ) {
        this.client = new PayPalClient(options);
    }

    /**
     * Injects a correctly typed payment repository.
     * @returns A correctly typed payment repository.
     */
    protected getPaymentRepository<
        M extends SupportedMethods[number],
        Data extends ProviderPaymentDataMap[M] | ProviderReservationPaymentDataMap[M]
    >(): Repository<Payment<M, Data>> {
        return inject(repositoryTokenFor(Payment)) as Repository<Payment<M, Data>>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validatePaymentData<M extends SupportedMethods[number]>(
        method: M,
        data: PaymentDataMap[M]
    ): ValidatedPaymentDataMap[M] {
        // eslint-disable-next-line sonar/no-small-switch
        switch (method) {
            case KnownPaymentMethod.PAY_PAL: {
                if (data.amount <= 0) {
                    throw new Error('amount must be > 0');
                }
                if (!data.currencyCode) {
                    throw new Error('currencyCode required');
                }
                return data;
            }
            default: {
                throw new Error(`unsupported payment method ${method}`);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startPayment<M extends SupportedMethods[number]>(
        method: M,
        data: ValidatedPaymentDataMap[M]
    ): Promise<Payment<M, ProviderPaymentDataMap[M]>> {
        const { id, links } = await this.client.createOrder({
            intent: 'CAPTURE',
            purchase_units: [{ amount: { value: String(data.amount), currency_code: data.currencyCode } }],
            application_context: {
                cancel_url: data.cancelUrl,
                return_url: data.returnUrl
            }
        });
        const approvalUrl: string | undefined = links?.find(l => l.rel === 'approve' || l.rel === 'approval_url')?.href;

        return await this.getPaymentRepository<M, ProviderPaymentDataMap[M]>().create({
            amount: data.amount,
            currencyCode: data.currencyCode,
            data: {
                orderId: id,
                approvalUrl
            },
            transactionId: data.transactionId,
            paymentMethod: method,
            status: PaymentStatus.CREATED
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startPaymentReservation<
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(
        method: M,
        data: ValidatedPaymentDataMap[M]
    ): Promise<Payment<M, ProviderReservationPaymentDataMap[M]>> {
        const { id, links } = await this.client.createOrder({
            intent: 'AUTHORIZE',
            purchase_units: [{ amount: { value: String(data.amount), currency_code: data.currencyCode } }],
            application_context: {
                cancel_url: data.cancelUrl,
                return_url: data.returnUrl
            }
        });

        const approvalUrl: string | undefined = links?.find(l => l.rel === 'approve' || l.rel === 'approval_url')?.href;

        return await this.getPaymentRepository<M, ProviderReservationPaymentDataMap[M]>().create({
            amount: data.amount,
            currencyCode: data.currencyCode,
            data: {
                orderId: id,
                approvalUrl
            },
            transactionId: data.transactionId,
            paymentMethod: method,
            status: PaymentStatus.CREATED
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPaymentReservation<
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderReservationPaymentDataMap[M]>): Promise<void> {
        if (!payment.data?.orderId) {
            throw new Error('missing payment data orderId; cannot confirm reservation');
        }

        try {
            const resp: GetOrderResp = await this.client.authorizeOrder(payment.data.orderId);

            let foundAuthId: string | undefined;
            for (const pu of resp.purchase_units ?? []) {
                const id: string | undefined = pu.payments?.authorizations?.at(0)?.id;
                if (id) {
                    foundAuthId = id;
                    break;
                }
            }

            if (!foundAuthId) {
                throw new Error('no authorization found on order; reservation not confirmed yet');
            }

            payment.data = {
                ...payment.data,
                authorizationId: foundAuthId
            };
            payment.status = PaymentStatus.RESERVED;
            payment.error = undefined;
        }
        catch (error: unknown) {
            payment.status = PaymentStatus.FAILED;
            payment.error = error instanceof Error ? error : new Error(String(error));
        }

        await this.getPaymentRepository().updateById(payment.id, payment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPayment<M extends SupportedMethods[number]>(
        payment: Payment<M, ProviderPaymentDataMap[M]>
    ): Promise<void> {
        if (!payment.data?.orderId) {
            throw new Error('missing payment data orderId; cannot confirm payment');
        }

        try {
            const resp: CaptureOrderResp = await this.client.captureOrder(payment.data.orderId);
            // TODO: handle payments with multiple parts
            const capture: PayPalCapture | undefined = resp.purchase_units?.[0]?.payments?.captures?.[0];
            const captureStatus: string | undefined = capture?.status ?? resp.status;

            if (capture?.id && captureStatus === 'COMPLETED') {
                payment.status = PaymentStatus.PAID;
                payment.data = { ...payment.data, captureId: capture.id };
                payment.error = undefined;
            }
            else {
                payment.status = PaymentStatus.FAILED;
                payment.error = new Error(`capture failed, status=${String(captureStatus)}`);
                payment.data = { ...payment.data, captureId: capture?.id };
            }
        }
        catch (error) {
            payment.status = PaymentStatus.FAILED;
            payment.error = error instanceof Error ? error : new Error(String(error));
        }

        await this.getPaymentRepository<M, ProviderPaymentDataMap[M]>().updateById(payment.id, payment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async collectPaymentFromReservation<
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderReservationPaymentDataMap[M]>): Promise<void> {
        // ensure we have an authorization id
        let authId: string | undefined = payment.data?.authorizationId;
        if (!authId && payment.data?.orderId) {
            const orderResp: GetOrderResp = await this.client.getOrder(String(payment.data.orderId));
            for (const pu of orderResp.purchase_units ?? []) {
                const id: string | undefined = pu.payments?.authorizations?.at(0)?.id;
                if (id) {
                    authId = id;
                    break;
                }
            }
        }

        if (!authId) {
            throw new Error('missing authorizationId; cannot collect from reservation');
        }

        try {
            const captureResp: AuthorizationCaptureResp = await this.client.captureAuthorization(
                authId,
                { value: String(payment.amount), currency_code: payment.currencyCode }
            );

            if (captureResp.id && captureResp.status === 'COMPLETED') {
                payment.status = PaymentStatus.PAID;
                payment.data = {
                    ...payment.data,
                    captureId: captureResp.id
                };
                payment.error = undefined;
            }
            else {
                payment.status = PaymentStatus.FAILED;
                payment.error = new Error(`authorization capture failed, status=${String(captureResp.status)}`);
                payment.data = {
                    ...payment.data,
                    captureId: captureResp.id
                };
            }
        }
        catch (error: unknown) {
            payment.status = PaymentStatus.FAILED;
            payment.error = error instanceof Error ? error : new Error(String(error));
        }

        await this.getPaymentRepository().updateById(payment.id, payment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async cancelPayment<M extends KnownPaymentMethod.PAY_PAL>(
        payment: Payment<M, ProviderPaymentDataMap[M]> | Payment<M, ProviderReservationPaymentDataMap[M]>
    ): Promise<void> {
        // If there's an authorization, try to void it
        if (payment.data?.authorizationId) {
            try {
                await this.client.voidAuthorization(payment.data?.authorizationId);
                payment.status = PaymentStatus.CANCELLED;
                payment.error = undefined;
            }
            catch (error: unknown) {
                payment.status = PaymentStatus.FAILED;
                payment.error = error instanceof Error ? error : new Error(String(error));
            }

            await this.getPaymentRepository<M, ProviderReservationPaymentDataMap[M]>().updateById(payment.id, payment);
            return;
        }

        // If payment is only created (order created, not authorized), we can cancel locally
        if (payment.status === PaymentStatus.CREATED) {
            payment.status = PaymentStatus.CANCELLED;
            payment.error = undefined;
            await this.getPaymentRepository<M, ProviderPaymentDataMap[M]>().updateById(payment.id, payment);
            return;
        }

        // If payment is already captured, cancellation isn't possible — refund must be used
        if (payment.data?.captureId || payment.status === PaymentStatus.PAID) {
            throw new Error('payment already captured; use refundPayment to refund the capture');
        }

        // Fallback: mark cancelled
        payment.status = PaymentStatus.CANCELLED;
        payment.error = undefined;
        await this.getPaymentRepository().updateById(payment.id, payment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refundPayment<
        M extends {
            [K in SupportedMethods[number]]: RefundSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderPaymentDataMap[M]>): Promise<void> {
        if (!payment.data?.captureId) {
            throw new Error('missing captureId on payment.data; cannot refund payment');
        }

        try {
            const resp: RefundCaptureResp = await this.client.refundCapture(payment.data.captureId, {
                value: String(payment.amount),
                currency_code: payment.currencyCode
            });

            if (resp.id && resp.status === 'COMPLETED') {
                payment.status = PaymentStatus.REFUNDED;
                payment.data = { ...payment.data, refundId: resp.id };
                payment.error = undefined;
            }
            else {
                payment.status = PaymentStatus.FAILED;
                payment.error = new Error(`refund failed, status=${String(resp.status)}`);
                payment.data = { ...payment.data, refundId: resp.id };
            }
        }
        catch (error: unknown) {
            payment.status = PaymentStatus.FAILED;
            payment.error = error instanceof Error ? error : new Error(String(error));
        }

        await this.getPaymentRepository().updateById(payment.id, payment);
    }
}