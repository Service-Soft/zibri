import { FrameworkColumnRegistry } from '../../../data-source/migration/framework-column.registry';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { type CurrencyCode } from '../../../localization/models/currency-code.model';
import { InvoiceAddress } from './invoice-address.model';
import { InvoiceItem } from './invoice-item.model';
import { InvoiceReference } from './invoice-reference.model';
import { InvoiceType } from './invoice-type.enum';

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
    /**
     * The kind of document: an invoice or a credit note. `INVOICE` by default.
     */
    @Property.string({ enum: InvoiceType, required: false, default: () => InvoiceType.INVOICE })
    type?: InvoiceType | null;
    /**
     * The invoices this one references, such as the invoice a credit note corrects. None when null.
     */
    @Property.array({ items: { type: 'object', cls: () => InvoiceReference }, required: false })
    precedingInvoices?: InvoiceReference[] | null;
    /**
     * When the invoice was issued: given its final number and sent. Null for a draft. With
     * `issuedInvoicesReadOnly` of the invoicing options, an issued invoice cannot be changed or deleted.
     */
    @Property.date({ required: false })
    issuedAt?: Date | null;
}

// the invoices stored before were all invoices, and none referenced another. When one was issued is
// not known, so it stays a draft as far as `issuedInvoicesReadOnly` goes
FrameworkColumnRegistry.register(
    { entity: Invoice, property: 'type', storedValue: () => InvoiceType.INVOICE, meansAbsent: value => value === InvoiceType.INVOICE },
    { entity: Invoice, property: 'precedingInvoices', meansAbsent: value => Array.isArray(value) && value.length === 0 },
    { entity: Invoice, property: 'issuedAt' }
);