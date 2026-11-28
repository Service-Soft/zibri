import { type InvoiceArchiveOptions } from './invoice-archive-options.model';

/**
 * Input for archiving the documents of issued invoices: the `store`, the `locale` and `resolveConformance`, which are
 * required, and the `retention`, 8 years unless given.
 */
export type InvoiceArchiveOptionsInput = Omit<InvoiceArchiveOptions, 'retention'> & Partial<Pick<InvoiceArchiveOptions, 'retention'>>;
