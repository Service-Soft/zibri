import { type InvoiceQueryModel } from 'zibri-contract';

/**
 * Which invoices `findInvoices` answers: those a `search` finds by their number or their customer, issued or drafts,
 * of a type, and open or not. Every invoice and credit note of the active tenant by default.
 */
// the query of GET /invoices without its page and tenant, so that the route and the service take the same filter
export type InvoiceFilter = Omit<InvoiceQueryModel, 'page' | 'limit' | 'tenantId'>;