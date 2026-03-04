import { type PaymentMethod } from './payment-method.model';
import { PaymentStatus } from './payment-status.enum';
import { AnyObject } from '../../../entity/any-object.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { type CurrencyCode } from '../../../localization/models/currency-code.model';

/**
 * Entity for an payment that has been made.
 */
@Entity()
export class Payment<M extends PaymentMethod, Data extends AnyObject> extends BaseEntity {
    /**
     * The transactionId, should be provided eg. From the client side of a checkout to prevent duplicate payments.
     */
    @Property.string({ format: 'uuid', unique: true })
    transactionId!: string;
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
    data?: Data;
    /**
     * An error that the payment failed with.
     */
    @Property.unknown({ required: false })
    error?: Error;
}