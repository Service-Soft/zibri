import { PaymentServiceInterface } from './payment-service.interface.ts';
import { PaymentDataForMethod, ValidatedPaymentDataForMethod, PaymentForMethod, AllowedReservationMethods, PaymentReservationForMethod, AllowedCancellationMethods, AllowedRefundMethods } from './payment-service.types.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../../di/decorators/inject.decorator.ts';
import { Injectable } from '../../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { AnyObject } from '../../../entity/any-object.model.ts';
import { ConflictError } from '../../../error-handling/errors/conflict.error.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { type LeaseServiceInterface } from '../../../leases/lease-service.interface.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { type LoggerInterface } from '../../../logging/logger.interface.ts';
import { Ms } from '../../../utilities/ms.ts';
import { PaymentMethod } from '../models/payment-method.model.ts';
import { type PaymentPluginOptions } from '../models/payment-plugin-options.model.ts';
import { PaymentStatus } from '../models/payment-status.enum.ts';
import { Payment } from '../models/payment.model.ts';
import { ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from '../payment.tokens.ts';
import { AnyPaymentProviderInterface } from '../providers/payment-provider.interface.ts';

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
        protected readonly logger: LoggerInterface
    ) {}

    // read when used rather than injected: this is built at every boot that uses the plugin, and
    // ZibriPaymentPlugin.validate names the entity when it is missing - which it could not, if
    // building this had failed on a repository token first

    /**
     * The repository of the payments.
     * @returns The repository.
     */
    protected get paymentRepository(): Repository<Payment<string, AnyObject>> {
        return inject(repositoryTokenFor(Payment));
    }

    private get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

    private findPaymentProviderForMethod<M extends Methods[number]>(method: M): P[number] {
        const name: string = this.options.providerNameForMethod[method];
        const provider: P[number] | undefined = this.options.paymentProviders.find(p => p.name === name);
        if (!provider) {
            throw new InternalError(`No provider found for payment method "${method}"`);
        }
        return provider;
    }

    /**
     * Runs a transition of a payment on the payment as it is stored, one transition of it at a time.
     *
     * The payment handed in is the caller's copy, and two copies of one payment - a double click, a
     * retried request, two replicas - both say it is waiting to be confirmed. So the transition waits
     * for any other one of the same payment, reads the row, and is judged by that. Once it is done,
     * the caller's copy is brought up to date with what was written.
     * @param payment - The caller's copy of the payment.
     * @param transition - Decides on the stored payment and calls the provider.
     */
    private async transition<T extends Payment<string, AnyObject>>(payment: T, transition: (stored: T) => Promise<void>): Promise<void> {
        await this.leaseService.withLease(
            // renewed while the provider is called, and waited for as long as one call may take
            { key: `zibri.payment:${payment.id}`, mode: 'wait', leaseInMs: Ms.SECOND * 30, acquireTimeoutInMs: Ms.MINUTE },
            async () => {
                await transition(await this.findStored(payment));
                Object.assign(payment, await this.findStored(payment));
            }
        );
    }

    /**
     * Reads the stored row of a payment.
     * @param payment - The payment.
     * @returns The row, typed as the payment it is the row of.
     */
    private async findStored<T extends Payment<string, AnyObject>>(payment: T): Promise<T> {
        // the repository is typed for the payments of every method, and the row of a payment of one
        // is a payment of that method
        return await this.paymentRepository.findById(payment.id) as T;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async validatePaymentData<M extends Methods[number]>(
        method: M,
        data: PaymentDataForMethod<Methods, M, P>
    ): Promise<ValidatedPaymentDataForMethod<Methods, M, P>> {
        const provider: P[number] = this.findPaymentProviderForMethod(method);
        const res: ValidatedPaymentDataForMethod<Methods, M, P> = await provider.validatePaymentData(
            method,
            data
        ) as ValidatedPaymentDataForMethod<Methods, M, P>;

        // eslint-disable-next-line jsdoc-js/require-jsdoc
        const { transactionId } = data as unknown as { transactionId: string };
        if ((await this.paymentRepository.findAll({ where: { transactionId } })).length) {
            throw new ConflictError($ts`A payment for the transactionId "${transactionId}" already exists.`);
        }
        return res;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async startPayment<M extends Methods[number]>(
        method: M,
        data: ValidatedPaymentDataForMethod<Methods, M, P>
    ): Promise<PaymentForMethod<Methods, M, P>> {
        const provider: P[number] = this.findPaymentProviderForMethod(method);
        return await provider.startPayment(method, data) as PaymentForMethod<Methods, M, P>;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async startPaymentReservation<M extends AllowedReservationMethods<Methods, P>>(
        method: M,
        data: ValidatedPaymentDataForMethod<Methods, M, P>
    ): Promise<PaymentReservationForMethod<Methods, M, P>> {
        const provider: P[number] = this.findPaymentProviderForMethod(method);
        return await provider.startPaymentReservation(method, data) as PaymentReservationForMethod<Methods, M, P>;
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async confirmPaymentReservation<M extends AllowedReservationMethods<Methods, P>>(
        payment: PaymentReservationForMethod<Methods, M, P>
    ): Promise<void> {
        await this.transition(payment, async stored => {
            if (stored.status === PaymentStatus.RESERVED) {
                // already reserved, a warning is enough here as this is probably just a timing problem.
                this.logger.warn(
                    `Tried to confirm a payment reservation (transactionId: ${stored.transactionId}) that has already been reserved`
                );
                return;
            }
            if (stored.status !== PaymentStatus.CREATED) {
                throw new ConflictError($ts`Cannot confirm payment in status ${stored.status}.`);
            }
            await this.findPaymentProviderForMethod(stored.paymentMethod).confirmPaymentReservation(stored);
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async confirmPayment<M extends Methods[number]>(payment: PaymentForMethod<Methods, M, P>): Promise<void> {
        await this.transition(payment, async stored => {
            if (stored.status === PaymentStatus.PAID) {
                // already confirmed, a warning is enough here as this is probably just a timing problem.
                this.logger.warn(`Tried to confirm a payment (transactionId: ${stored.transactionId}) that has already been confirmed`);
                return;
            }
            if (stored.status !== PaymentStatus.CREATED) {
                throw new ConflictError($ts`Cannot confirm payment in status ${stored.status}.`);
            }
            await this.findPaymentProviderForMethod(stored.paymentMethod).confirmPayment(stored);
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async collectPaymentFromReservation<M extends AllowedReservationMethods<Methods, P>>(
        payment: PaymentReservationForMethod<Methods, M, P>
    ): Promise<void> {
        await this.transition(payment, async stored => {
            if (stored.status === PaymentStatus.PAID) {
                // already confirmed, a warning is enough here as this is probably just a timing problem.
                this.logger.warn(`Tried to collect a payment (transactionId: ${stored.transactionId}) that has already been collected`);
                return;
            }
            if (stored.status !== PaymentStatus.RESERVED) {
                throw new ConflictError($ts`Can only collect payments from reserved payments.`);
            }
            await this.findPaymentProviderForMethod(stored.paymentMethod).collectPaymentFromReservation(stored);
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async cancelPayment<M extends AllowedCancellationMethods<Methods, P>>(
        payment: PaymentForMethod<Methods, M, P> | PaymentReservationForMethod<Methods, M, P>
    ): Promise<void> {
        await this.transition(payment, async stored => {
            if (stored.status === PaymentStatus.CANCELLED) {
                // already cancelled, a warning is enough here as this is probably just a timing problem.
                this.logger.warn(`Tried to cancel a payment (transactionId: ${stored.transactionId}) that has already been cancelled`);
                return;
            }
            if (stored.status !== PaymentStatus.CREATED && stored.status !== PaymentStatus.RESERVED) {
                throw new ConflictError($ts`Cannot cancel payment in status ${stored.status}.`);
            }
            await this.findPaymentProviderForMethod(stored.paymentMethod).cancelPayment(stored);
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async refundPayment<M extends AllowedRefundMethods<Methods, P>>(payment: PaymentForMethod<Methods, M, P>): Promise<void> {
        await this.transition(payment, async stored => {
            if (stored.status === PaymentStatus.REFUNDED) {
                // already refunded, a warning is enough here as this is probably just a timing problem.
                this.logger.warn(`Tried to refund a payment (transactionId: ${stored.transactionId}) that has already been refunded`);
                return;
            }
            if (stored.status !== PaymentStatus.PAID) {
                throw new ConflictError($ts`Cannot refund payment in status ${stored.status}.`);
            }
            await this.findPaymentProviderForMethod(stored.paymentMethod).refundPayment(stored);
        });
    }
}