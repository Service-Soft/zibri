import { PaymentProviderInterface } from '../payment-provider.interface.ts';
import { AuthorizationCaptureResp, CaptureOrderResp, CreateOrderResp, GetOrderResp, PayPalAuthorization, PayPalCapture, PayPalClient, PayPalPaymentIntent, RefundCaptureResp } from './pay-pal-client.ts';
import { Repository } from '../../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../../../di/inject.function.ts';
import { Property } from '../../../../entity/decorators/property.decorator.ts';
import { BadRequestError } from '../../../../error-handling/errors/bad-request.error.ts';
import { InternalError } from '../../../../error-handling/internal-error.model.ts';
import { currencyCodeEnum, type CurrencyCode } from '../../../../localization/models/currency-code.model.ts';
import { $ts } from '../../../../localization/translate.function.ts';
import { errorToLoggedError } from '../../../../logging/error-to-logged-error.function.ts';
import { LoggedError } from '../../../../logging/logged-error.model.ts';
import { BigNumber } from '../../../../utilities/number.utilities.ts';
import { KnownPaymentMethod } from '../../models/payment-method.model.ts';
import { PaymentStatus } from '../../models/payment-status.enum.ts';
import { Payment } from '../../models/payment.model.ts';

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
export class PayPalPaymentData {
    /**
     * The amount of the payment, with at most as many decimals as its currency has: none for `HUF`,
     * `JPY` and `TWD`, two for every other currency PayPal takes.
     *
     * `min` is inclusive, so this rejects negatives and lets a zero through. `validatePaymentData`
     * is what refuses that one - the real bound is above zero, and metadata cannot say so.
     */
    @Property.number({ format: 'bignumber', min: 0 })
    amount!: BigNumber;
    /**
     * The currency of the payment.
     */
    @Property.string({ enum: currencyCodeEnum })
    currencyCode!: CurrencyCode;
    /**
     * The url to return to to confirm the payment.
     */
    @Property.string({ required: false })
    returnUrl?: string;
    /**
     * The url to return to to cancel the payment.
     */
    @Property.string({ required: false })
    cancelUrl?: string;
    /**
     * The transactionId, used to prevent duplicate payments.
     */
    @Property.string()
    transactionId!: string;
}

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
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    declare readonly __supportedMethods: SupportedMethods;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    declare readonly __paymentDataMap: PaymentDataMap;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    declare readonly __validatedDataMap: ValidatedPaymentDataMap;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    declare readonly __providerPaymentDataMap: ProviderPaymentDataMap;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    declare readonly __providerReservationPaymentDataMap: ProviderReservationPaymentDataMap;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    declare readonly __cancellationSupportMap: CancellationSupport;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    declare readonly __refundSupportMap: RefundSupport;
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    declare readonly __reservationSupportMap: ReservationSupport;

    /**
     * Client that encapsulates the PayPal API.
     */
    protected readonly client: PayPalClient;

    /**
     * Where PayPal's api is reached, which the environment of the options decides.
     * @returns The base url of the api.
     */
    protected get apiUrl(): string {
        return this.options.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    }

    constructor(
        readonly name: string,
        protected readonly options: PayPalPaymentProviderOptions
    ) {
        this.client = new PayPalClient(options, this.apiUrl);
    }

    /**
     * Injects a correctly typed payment repository.
     * @returns A correctly typed payment repository.
     */
    protected getPaymentRepository<
        M extends SupportedMethods[number],
        Data extends ProviderPaymentDataMap[M] | ProviderReservationPaymentDataMap[M]
    >(): Repository<Payment<M, Data>> {
        return inject(repositoryTokenFor(Payment)) as unknown as Repository<Payment<M, Data>>;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    validatePaymentData<M extends SupportedMethods[number]>(
        method: M,
        data: PaymentDataMap[M]
    ): ValidatedPaymentDataMap[M] {
        // eslint-disable-next-line sonarjs/no-small-switch
        switch (method) {
            case KnownPaymentMethod.PAY_PAL: {
                if (!data.amount.isGreaterThan(0)) {
                    throw new BadRequestError($ts`The amount has to be greater than 0.`);
                }
                if (!data.currencyCode) {
                    throw new BadRequestError($ts`A currency code is required.`);
                }
                // refused here rather than rounded when it is sent: an amount the caller did not
                // ask for is a charge they did not agree to, and PayPal refuses it anyway
                const decimals: number = PayPalPaymentProvider.getCurrencyDecimals(data.currencyCode);
                if ((data.amount.decimalPlaces() ?? 0) > decimals) {
                    throw new BadRequestError($ts`An amount in ${data.currencyCode} has at most ${decimals} decimals.`);
                }
                return data;
            }
            default: {
                // oxlint-disable-next-line typescript/restrict-template-expressions
                throw new InternalError(`unsupported payment method ${method}`);
            }
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async startPayment<M extends SupportedMethods[number]>(
        method: M,
        data: ValidatedPaymentDataMap[M]
    ): Promise<Payment<M, ProviderPaymentDataMap[M]>> {
        return await this.startOrder(method, data, 'CAPTURE');
    }

    /**
     * Stores a new payment and creates its order at PayPal.
     *
     * The row first: its unique transactionId refuses a repeated payment before PayPal has an order
     * for it, which checking before the order is created leaves open to a second request.
     * @param method - The payment method.
     * @param data - The validated payment data.
     * @param intent - Whether the order is captured at once or authorized first.
     * @returns The payment, holding the order.
     */
    private async startOrder<M extends SupportedMethods[number]>(
        method: M,
        data: ValidatedPaymentDataMap[M],
        intent: PayPalPaymentIntent
    ): Promise<Payment<M, ProviderPaymentDataMap[M]>> {
        const repository: Repository<Payment<M, ProviderPaymentDataMap[M]>> = this.getPaymentRepository<M, ProviderPaymentDataMap[M]>();
        const payment: Payment<M, ProviderPaymentDataMap[M]> = await repository.create({
            amount: data.amount,
            currencyCode: data.currencyCode,
            transactionId: data.transactionId,
            paymentMethod: method,
            status: PaymentStatus.CREATED
        });
        let order: CreateOrderResp;
        try {
            order = await this.client.createOrder({
                intent,
                purchase_units: [
                    {
                        amount: {
                            value: PayPalPaymentProvider.getValue(data.amount, data.currencyCode),
                            currency_code: data.currencyCode
                        }
                    }
                ],
                application_context: {
                    cancel_url: data.cancelUrl,
                    return_url: data.returnUrl
                }
            });
        }
        catch (error) {
            // nothing was ordered, so the transactionId may be paid with again
            await repository.deleteById(payment.id);
            throw error;
        }
        const approvalUrl: string | undefined = order.links?.find(l => l.rel === 'approve' || l.rel === 'approval_url')?.href;
        return await repository.updateById(payment.id, { data: { orderId: order.id, approvalUrl } });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async startPaymentReservation<
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(
        method: M,
        data: ValidatedPaymentDataMap[M]
    ): Promise<Payment<M, ProviderReservationPaymentDataMap[M]>> {
        return await this.startOrder(method, data, 'AUTHORIZE');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async confirmPaymentReservation<
        M extends {
            [K in SupportedMethods[number]]: ReservationSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderReservationPaymentDataMap[M]>): Promise<void> {
        const orderId: string | undefined = payment.data?.orderId;
        if (!orderId) {
            throw new InternalError('missing payment data orderId; cannot confirm reservation');
        }

        let resp: GetOrderResp;
        try {
            resp = await this.client.authorizeOrder(orderId, `${payment.id}:authorize`);
        }
        catch (error: unknown) {
            await this.reconcile(payment, orderId, error, order => {
                const authorization: PayPalAuthorization | undefined = PayPalPaymentProvider.findAuthorization(order);
                return authorization == undefined
                    ? undefined
                    : { status: PaymentStatus.RESERVED, data: { ...payment.data, authorizationId: authorization.id } };
            });
            return;
        }

        const authorization: PayPalAuthorization | undefined = PayPalPaymentProvider.findAuthorization(resp);
        if (authorization == undefined) {
            // not a refusal either: the order can still be authorized, so it stays as it is
            throw new InternalError('no authorization found on order; reservation not confirmed yet');
        }
        await this.write(payment, { status: PaymentStatus.RESERVED, data: { ...payment.data, authorizationId: authorization.id } });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async confirmPayment<M extends SupportedMethods[number]>(
        payment: Payment<M, ProviderPaymentDataMap[M]>
    ): Promise<void> {
        const orderId: string | undefined = payment.data?.orderId;
        if (!orderId) {
            throw new InternalError('missing payment data orderId; cannot confirm payment');
        }

        let resp: CaptureOrderResp;
        try {
            resp = await this.client.captureOrder(orderId, `${payment.id}:capture`);
        }
        catch (error) {
            await this.reconcile(payment, orderId, error, order => this.toPaidFrom(payment, order));
            return;
        }

        // TODO: handle payments with multiple parts
        const capture: PayPalCapture | undefined = resp.purchase_units?.[0]?.payments?.captures?.[0];
        const captureStatus: string | undefined = capture?.status ?? resp.status ?? undefined;
        if (capture?.id && captureStatus === 'COMPLETED') {
            await this.write(payment, { status: PaymentStatus.PAID, data: { ...payment.data, captureId: capture.id } });
            return;
        }
        // PayPal answered, and what it answered is that the money was not captured
        await this.write(payment, {
            status: PaymentStatus.FAILED,
            data: { ...payment.data, captureId: capture?.id },
            error: errorToLoggedError(new Error(`capture failed, status=${String(captureStatus)}`))
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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
            throw new InternalError('missing authorizationId; cannot collect from reservation');
        }

        let captureResp: AuthorizationCaptureResp;
        try {
            captureResp = await this.client.captureAuthorization(
                authId,
                { value: PayPalPaymentProvider.getValue(payment.amount, payment.currencyCode), currency_code: payment.currencyCode },
                `${payment.id}:collect`
            );
        }
        catch (error: unknown) {
            const orderId: string | undefined = payment.data?.orderId;
            if (orderId == undefined) {
                throw error;
            }
            await this.reconcile(payment, orderId, error, order => this.toPaidFrom(payment, order));
            return;
        }

        if (captureResp.id && captureResp.status === 'COMPLETED') {
            await this.write(payment, { status: PaymentStatus.PAID, data: { ...payment.data, captureId: captureResp.id } });
            return;
        }
        await this.write(payment, {
            status: PaymentStatus.FAILED,
            data: { ...payment.data, captureId: captureResp.id },
            error: errorToLoggedError(new Error(`authorization capture failed, status=${String(captureResp.status)}`))
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async cancelPayment<M extends KnownPaymentMethod.PAY_PAL>(
        payment: Payment<M, ProviderPaymentDataMap[M]> | Payment<M, ProviderReservationPaymentDataMap[M]>
    ): Promise<void> {
        // If there's an authorization, try to void it
        const authorizationId: string | undefined = payment.data?.authorizationId;
        if (authorizationId) {
            try {
                await this.client.voidAuthorization(authorizationId, `${payment.id}:void`);
            }
            catch (error: unknown) {
                const orderId: string | undefined = payment.data?.orderId;
                if (orderId == undefined) {
                    throw error;
                }
                await this.reconcile(payment, orderId, error, order => PayPalPaymentProvider.findAuthorization(order)?.status === 'VOIDED'
                    ? { status: PaymentStatus.CANCELLED, data: payment.data }
                    : undefined);
                return;
            }
            await this.write(payment, { status: PaymentStatus.CANCELLED, data: payment.data });
            return;
        }

        // If payment is only created (order created, not authorized), we can cancel locally
        if (payment.status === PaymentStatus.CREATED) {
            await this.write(payment, { status: PaymentStatus.CANCELLED, data: payment.data });
            return;
        }

        // If payment is already captured, cancellation isn't possible — refund must be used
        if (payment.data?.captureId || payment.status === PaymentStatus.PAID) {
            throw new InternalError('payment already captured; use refundPayment to refund the capture');
        }

        // Fallback: mark cancelled
        await this.write(payment, { status: PaymentStatus.CANCELLED, data: payment.data });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async refundPayment<
        M extends {
            [K in SupportedMethods[number]]: RefundSupport[K] extends true ? K : never
        }[SupportedMethods[number]]
    >(payment: Payment<M, ProviderPaymentDataMap[M]>): Promise<void> {
        const captureId: string | undefined = payment.data?.captureId;
        if (!captureId) {
            throw new InternalError('missing captureId on payment.data; cannot refund payment');
        }

        let resp: RefundCaptureResp;
        try {
            resp = await this.client.refundCapture(
                captureId,
                { value: PayPalPaymentProvider.getValue(payment.amount, payment.currencyCode), currency_code: payment.currencyCode },
                `${payment.id}:refund`
            );
        }
        catch (error: unknown) {
            const orderId: string | undefined = payment.data?.orderId;
            if (orderId == undefined) {
                throw error;
            }
            await this.reconcile(payment, orderId, error, order => PayPalPaymentProvider.findCapture(order)?.status === 'REFUNDED'
                ? { status: PaymentStatus.REFUNDED, data: payment.data }
                : undefined);
            return;
        }

        if (resp.id && resp.status === 'COMPLETED') {
            await this.write(payment, { status: PaymentStatus.REFUNDED, data: { ...payment.data, refundId: resp.id } });
            return;
        }
        // still paid: a refund PayPal declined leaves the money where it was, which FAILED would hide
        await this.write(payment, {
            status: payment.status,
            data: { ...payment.data, refundId: resp.id },
            error: errorToLoggedError(new Error(`refund failed, status=${String(resp.status)}`))
        });
    }

    /**
     * Writes what a step did to a payment, and clears the error of an earlier one unless it failed too.
     * @param payment - The payment.
     * @param changes - Its new status and data, and the error when the step failed.
     */
    private async write<M extends SupportedMethods[number]>(
        payment: Payment<M, PayPalPaymentProviderPaymentData>,
        changes: PaymentChanges
    ): Promise<void> {
        await this.getPaymentRepository<M, PayPalPaymentProviderPaymentData>().updateById(payment.id, { error: undefined, ...changes });
    }

    /**
     * Learns from the order what a call that threw did, since its answer is all that was lost.
     *
     * A capture whose answer timed out may well have captured, and a repeated one is refused as
     * already captured: recording either as FAILED records captured money as never paid, from a
     * status nothing can be confirmed from again. So the order is asked, and what it says is written.
     * When it says the step was not done, or cannot be asked, the payment stays as it is and the
     * error is thrown: every call is sent with an idempotency key, so trying again is safe.
     * @param payment - The payment.
     * @param orderId - The id of its order.
     * @param error - What the call threw.
     * @param read - The changes the order says happened, or undefined when it says the step was not done.
     * @throws The error of the call, when the order does not say the step was done.
     */
    private async reconcile<M extends SupportedMethods[number]>(
        payment: Payment<M, PayPalPaymentProviderPaymentData>,
        orderId: string,
        error: unknown,
        read: (order: GetOrderResp) => PaymentChanges | undefined
    ): Promise<void> {
        let order: GetOrderResp;
        try {
            order = await this.client.getOrder(orderId);
        }
        catch {
            throw error;
        }
        const changes: PaymentChanges | undefined = read(order);
        if (changes == undefined) {
            throw error;
        }
        await this.write(payment, changes);
    }

    /**
     * The changes that record a payment as paid, when its order holds a completed capture.
     * @param payment - The payment.
     * @param order - Its order.
     * @returns The changes, or undefined when nothing was captured.
     */
    private toPaidFrom<M extends SupportedMethods[number]>(
        payment: Payment<M, PayPalPaymentProviderPaymentData>,
        order: GetOrderResp
    ): PaymentChanges | undefined {
        const capture: PayPalCapture | undefined = PayPalPaymentProvider.findCapture(order);
        return capture?.status === 'COMPLETED'
            ? { status: PaymentStatus.PAID, data: { ...payment.data, captureId: capture.id } }
            : undefined;
    }

    /**
     * Finds the capture of an order.
     * @param order - The order.
     * @returns Its first capture, or undefined.
     */
    private static findCapture(order: GetOrderResp): PayPalCapture | undefined {
        return order.purchase_units?.flatMap(unit => unit.payments?.captures ?? []).at(0);
    }

    /**
     * Finds the authorization of an order.
     * @param order - The order.
     * @returns Its first authorization, or undefined.
     */
    private static findAuthorization(order: GetOrderResp): PayPalAuthorization | undefined {
        return order.purchase_units?.flatMap(unit => unit.payments?.authorizations ?? []).at(0);
    }

    /**
     * How many decimals PayPal takes in an amount of a currency.
     * @param currencyCode - The currency.
     * @returns The decimals.
     */
    private static getCurrencyDecimals(currencyCode: CurrencyCode): number {
        // PayPal's own rule, which is not ISO 4217's: HUF and TWD have two decimals there, and PayPal
        // refuses any. Every other currency PayPal takes has two
        return ['HUF', 'JPY', 'TWD'].includes(currencyCode) ? 0 : 2;
    }

    /**
     * Writes an amount the way PayPal reads it: in fixed notation, with the decimals of its currency.
     * @param amount - The amount, which `validatePaymentData` checked has no more decimals than that.
     * @param currencyCode - The currency of the amount.
     * @returns The value of the amount.
     */
    private static getValue(amount: BigNumber, currencyCode: CurrencyCode): string {
        return amount.toFixed(PayPalPaymentProvider.getCurrencyDecimals(currencyCode));
    }
}

/**
 * What a step writes to a payment.
 */
type PaymentChanges = {
    /**
     * The status it leaves the payment in.
     */
    status: PaymentStatus,
    /**
     * What the provider keeps of it.
     */
    data: PayPalPaymentProviderPaymentData | null | undefined,
    /**
     * Why the step failed, when it did.
     */
    error?: LoggedError
};