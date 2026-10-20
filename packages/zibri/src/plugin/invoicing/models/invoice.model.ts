import { InvoiceAddress } from './invoice-address.model.ts';
import { InvoiceItem } from './invoice-item.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { type CurrencyCode } from '../../../localization/models/currency-code.model.ts';

/**
 * Contains information about an invoice.
 */
@Entity({ allowOrphan: true })
export class Invoice extends BaseEntity {
    /**
     * The tenant that issued the invoice.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;
    /**
     * The invoice number, unique among the invoices of its tenant.
     */
    @Property.string({ unique: true })
    number!: string;
    /**
     * The actual content of the invoice.
     */
    @Property.array({ items: { type: 'object', cls: () => InvoiceItem } })
    items!: InvoiceItem[];
    /**
     * The date at which the invoice was created.
     * Defaults to now.
     */
    @Property.date({ default: () => new Date() })
    date!: Date;
    /**
     * The date at which the invoice items were/will be done.
     */
    @Property.date()
    performanceDate!: Date;
    /**
     * The date at which the invoice has to be paid.
     */
    @Property.date()
    dueDate!: Date;
    /**
     * The address data to which the invoice gets sent.
     * Contains information about the customer and the actual address.
     */
    @Property.object({ cls: () => InvoiceAddress })
    customerAddressData!: InvoiceAddress;
    /**
     * The text that is displayed before the invoice items.
     * Is an array of strings that represent paragraphs.
     */
    @Property.array({ items: { type: 'string' } })
    textBeforeItems!: string[];
    /**
     * The text that is displayed after the invoice items.
     * Is an array of strings that represent paragraphs.
     */
    @Property.array({ items: { type: 'string' } })
    textAfterItems!: string[];
    /**
     * The currency code of the invoice.
     */
    @Property.string()
    currency!: CurrencyCode;
}