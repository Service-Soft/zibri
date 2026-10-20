import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * Contains the information about how many invoices a tenant has created in a specific year.
 */
// one counter per recipient per year in each tenant, and neither column is unique on its own.
// Besides keeping a second counter row from ever existing, the constraint is what lets
// getConsecutiveNumber claim its number in a single statement instead of reading and writing it back.
@Entity({ allowOrphan: true, uniques: [['year', 'recipientId']] })
export class NumberInvoices extends BaseEntity {
    /**
     * The tenant whose invoices are counted.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;
    /**
     * The id of the recipient of the invoice.
     */
    @Property.string()
    recipientId!: string;
    /**
     * The amount of invoices of that year.
     */
    @Property.number({ format: 'integer' })
    number!: number;
    /**
     * The year for which this entity hold the amount of invoices.
     */
    @Property.number({ format: 'integer' })
    year!: number;
}