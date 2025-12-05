import { Entity, Property } from '../../../entity';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Contains the information about how many invoices have been created in a specific year.
 */
@Entity()
export class NumberInvoices extends BaseEntity {
    /**
     * The id of the recipient of the invoice.
     */
    @Property.string()
    recipientId!: string;
    /**
     * The amount of invoices of that year.
     */
    @Property.number()
    number!: number;
    /**
     * The year for which this entity hold the amount of invoices.
     */
    @Property.number()
    year!: number;
}