import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type InvoiceFilter } from '../models/invoice-filter.model';
import { type Invoice } from '../models/invoice.model';

/**
 * Finds the invoices and credit notes of the active tenant.
 */
export interface InvoiceServiceInterface {
    /**
     * Finds a page of the invoices and credit notes the filter matches, the latest day first, and how many match.
     * @param page - The page, counting from 1.
     * @param limit - How many invoices a page holds.
     * @param filter - The text a `search` finds them by, whether they are `issued`, their `type`, and whether they are
     * `open`.
     * @returns The page.
     * @throws A BadRequestError for `open` in an application without a payment source of the invoices.
     */
    findInvoices: (page: number, limit: number, filter: InvoiceFilter) => Promise<PaginationResult<Invoice>>
}