import { type InvoiceType } from './invoice-type.enum';

/**
 * What `GET /invoicing/invoices` takes in its query: a page of the invoices and credit notes, the latest day first,
 * narrowed by what is given. It answers a `PaginationResult` of `InvoiceModel`, with the count of every invoice
 * matching.
 */
export type InvoiceQueryModel = {
    /**
     * The page, counting from 1.
     */
    page: number,
    /**
     * How many invoices a page holds, at most 100.
     */
    limit: number,
    /**
     * Only the invoices whose number, or the company name, first name or last name of whose customer, contains this
     * text, whatever its case.
     */
    search?: string,
    /**
     * Only the issued invoices, `true`, or only the drafts, `false`.
     */
    issued?: boolean,
    /**
     * Only the invoices, or only the credit notes.
     */
    type?: InvoiceType,
    /**
     * Only the invoices with something left to pay, `true`, or with nothing, `false`, after their credit notes and
     * what is paid of them. Narrows to invoices, leaving out the credit notes. Taken by an application with a payment
     * source of the invoices, such as the bank plugin with `matching`.
     */
    open?: boolean,
    /**
     * The tenant whose invoices are read, for a request with the platform permission naming no tenant.
     */
    tenantId?: string
};