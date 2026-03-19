import { PaymentServiceInterface } from './payment-service.interface';
import { PaymentDataForMethod, ValidatedPaymentDataForMethod, PaymentForMethod, AllowedReservationMethods, PaymentReservationForMethod, AllowedCancellationMethods, AllowedRefundMethods } from './payment-service.types';
import { Repository } from '../../../data-source/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { AnyObject } from '../../../entity/any-object.model';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { PaymentMethod } from '../models/payment-method.model';
import { type PaymentPluginOptions } from '../models/payment-plugin-options.model';
import { PaymentStatus } from '../models/payment-status.enum';
import { Payment } from '../models/payment.model';
import { ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from '../payment.tokens';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface';

/**
 * Default payment service implementation of zibri.
 */
@Injectable({ register: 'onUse' })
export class PaymentService<
    Methods extends readonly PaymentMethod[],
    P extends readonly AnyPaymentProviderInterface[]
>implements PaymentServiceInterface<Methods, P> {

    constructor(
        @Inject(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: PaymentPluginOptions<Methods, P>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface,
        @InjectRepository(Payment)
        protected readonly paymentRepository: Repository<Payment<string, AnyObject>>
    ) {}

    private findPaymentProviderForMethod<M extends Methods[number]>(method: M): P[number] {
        const name: string = this.options.providerNameForMethod[method];
        const provider: P[number] | undefined = this.options.paymentProviders.find(p => p.name === name);
        if (!provider) {
            throw new Error(`No provider found for payment method "${method}"`);
        }
        return provider;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validatePaymentData<M extends Methods[number]>(
        method: M,
        data: PaymentDataForMethod<Methods, M, P>
    ): Promise<ValidatedPaymentDataForMethod<Methods, M, P>> {
        const provider: P[number] = this.findPaymentProviderForMethod(method);
        const res: ValidatedPaymentDataForMethod<Methods, M, P> = await provider.validatePaymentData(
            method,
            data
        ) as ValidatedPaymentDataForMethod<Methods, M, P>;

        // eslint-disable-next-line jsdoc/require-jsdoc
        const { transactionId } = data as unknown as { transactionId: string };
        if ((await this.paymentRepository.findAll({ where: { transactionId } })).length) {
            throw new Error(`a payment for the transactionId "${transactionId}" already exists`);
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startPayment<M extends Methods[number]>(
        method: M,
        data: ValidatedPaymentDataForMethod<Methods, M, P>
    ): Promise<PaymentForMethod<Methods, M, P>> {
        const provider: P[number] = this.findPaymentProviderForMethod(method);
        return await provider.startPayment(method, data) as PaymentForMethod<Methods, M, P>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async startPaymentReservation<M extends AllowedReservationMethods<Methods, P>>(
        method: M,
        data: ValidatedPaymentDataForMethod<Methods, M, P>
    ): Promise<PaymentReservationForMethod<Methods, M, P>> {
        const provider: P[number] = this.findPaymentProviderForMethod(method);
        return await provider.startPaymentReservation(method, data) as PaymentReservationForMethod<Methods, M, P>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPaymentReservation<M extends AllowedReservationMethods<Methods, P>>(
        payment: PaymentReservationForMethod<Methods, M, P>
    ): Promise<void> {
        if (payment.status === PaymentStatus.RESERVED) {
            // already reserved, a warning is enough here as this is probably just a timing problem.
            await this.logger.warn(
                `Tried to confirm a payment reservation (transactionId: ${payment.transactionId}) that has already been reserved`
            );
            return undefined;
        }
        if (payment.status !== PaymentStatus.CREATED) {
            throw new Error(`Cannot confirm payment in status ${payment.status}`);
        }
        const provider: P[number] = this.findPaymentProviderForMethod(payment.paymentMethod);
        await provider.confirmPaymentReservation(payment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmPayment<M extends Methods[number]>(payment: PaymentForMethod<Methods, M, P>): Promise<void> {
        if (payment.status === PaymentStatus.PAID) {
            // already confirmed, a warning is enough here as this is probably just a timing problem.
            await this.logger.warn(`Tried to confirm a payment (transactionId: ${payment.transactionId}) that has already been confirmed`);
            return undefined;
        }
        if (payment.status !== PaymentStatus.CREATED) {
            throw new Error(`Cannot confirm payment in status ${payment.status}`);
        }
        const provider: P[number] = this.findPaymentProviderForMethod(payment.paymentMethod);
        await provider.confirmPayment(payment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async collectPaymentFromReservation<M extends AllowedReservationMethods<Methods, P>>(
        payment: PaymentReservationForMethod<Methods, M, P>
    ): Promise<void> {
        if (payment.status === PaymentStatus.PAID) {
            // already confirmed, a warning is enough here as this is probably just a timing problem.
            await this.logger.warn(`Tried to collect a payment (transactionId: ${payment.transactionId}) that has already been collected`);
            return undefined;
        }
        if (payment.status !== PaymentStatus.RESERVED) {
            throw new Error('Can only collect payments from reserved payments');
        }
        const provider: P[number] = this.findPaymentProviderForMethod(payment.paymentMethod);
        await provider.collectPaymentFromReservation(payment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async cancelPayment<M extends AllowedCancellationMethods<Methods, P>>(
        payment: PaymentForMethod<Methods, M, P> | PaymentReservationForMethod<Methods, M, P>
    ): Promise<void> {
        if (payment.status === PaymentStatus.CANCELLED) {
            // already cancelled, a warning is enough here as this is probably just a timing problem.
            await this.logger.warn(`Tried to collect a payment (transactionId: ${payment.transactionId}) that has already been collected`);
            return undefined;
        }
        if (payment.status !== PaymentStatus.CREATED && payment.status !== PaymentStatus.RESERVED) {
            throw new Error(`Cannot cancel payment in status ${payment.status}`);
        }
        const provider: P[number] = this.findPaymentProviderForMethod(payment.paymentMethod);
        await provider.cancelPayment(payment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async refundPayment<M extends AllowedRefundMethods<Methods, P>>(payment: PaymentForMethod<Methods, M, P>): Promise<void> {
        if (payment.status === PaymentStatus.REFUNDED) {
            // already refunded, a warning is enough here as this is probably just a timing problem.
            await this.logger.warn(`Tried to refund a payment (transactionId: ${payment.transactionId}) that has already been refunded`);
            return undefined;
        }
        if (payment.status !== PaymentStatus.PAID) {
            throw new Error(`Cannot refund payment in status ${payment.status}`);
        }
        const provider: P[number] = this.findPaymentProviderForMethod(payment.paymentMethod);
        await provider.refundPayment(payment);
    }
}