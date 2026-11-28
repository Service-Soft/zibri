import { type InvoiceAddressModel } from './invoice-address.model';
import { type InvoiceItemModel } from './invoice-item.model';
import { type InvoiceReferenceModel } from './invoice-reference.model';
import { type InvoiceType } from './invoice-type.enum';

/**
 * An invoice or a credit note of a tenant, as the routes of `/invoicing/invoices` answer it.
 */
export type InvoiceModel = {
    /**
     * The id of the invoice.
     */
    id: string,
    /**
     * The tenant that issued the invoice.
     */
    tenantId: string,
    /**
     * The number, unique among the invoices of its tenant. A draft has a temporary one, starting with `TEMP-`.
     */
    number: string,
    /**
     * The items.
     */
    items: InvoiceItemModel[],
    /**
     * The day of the invoice.
     */
    date: Date,
    /**
     * When the items were or will be done.
     */
    performanceDate: Date,
    /**
     * When the invoice is due.
     */
    dueDate: Date,
    /**
     * The customer and the address the invoice goes to.
     */
    customerAddressData: InvoiceAddressModel,
    /**
     * The paragraphs shown before the items.
     */
    textBeforeItems: string[],
    /**
     * The paragraphs shown after the items.
     */
    textAfterItems: string[],
    /**
     * The currency, such as `EUR`.
     */
    currency: string,
    /**
     * Whether it is an invoice or a credit note.
     */
    type?: InvoiceType | null,
    /**
     * The invoices it references, such as the invoice a credit note corrects.
     */
    precedingInvoices?: InvoiceReferenceModel[] | null,
    /**
     * When the invoice was issued, or null for a draft.
     */
    issuedAt?: Date | null
};
