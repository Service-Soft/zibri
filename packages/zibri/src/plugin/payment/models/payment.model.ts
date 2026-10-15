import { type PaymentMethod } from './payment-method.model';
import { PaymentStatus } from './payment-status.enum';
import { AnyObject } from '../../../entity/any-object.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { type CurrencyCode } from '../../../localization/models/currency-code.model';
import { LoggedError } from '../../../logging/logged-error.model';

/**
 * Entity for an payment that has been made.
 */
@Entity({ allowOrphan: true })
export class Payment<M extends PaymentMethod, Data extends AnyObject> extends BaseEntity {
    /**
     * The tenant the payment was made in.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;
    /**
     * The transactionId, should be provided eg. From the client side of a checkout to prevent duplicate payments.
     * Unique among the payments of its tenant.
     */
    @Property.string({ format: 'uuid', unique: true })
    transactionId!: string;
    /**
     * The createdAt date. Is set to now by default.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * The status of the payment.
     */
    @Property.string({ enum: PaymentStatus })
    status!: PaymentStatus;
    /**
     * The amount of the payment.
     */
    @Property.number()
    amount!: number;
    /**
     * The currency that the payment is in.
     */
    @Property.string()
    currencyCode!: CurrencyCode;
    /**
     * The used payment method.
     */
    @Property.string()
    paymentMethod!: M;
    /**
     * Additional data stored by the provider.
     */
    @Property.unknown({ required: false })
    data?: Data | null;
    /**
     * An error that the payment failed with.
     *
     * A `LoggedError` rather than an `Error`, because an `Error` keeps its message, stack and cause
     * on non-enumerable fields - a column storing one keeps `{}`, which is the only record a failed
     * charge leaves behind.
     */
    @Property.unknown({ required: false })
    error?: LoggedError | null;
}