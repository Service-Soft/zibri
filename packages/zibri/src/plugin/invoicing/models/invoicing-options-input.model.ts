import { type InvoiceArchiveOptionsInput } from './invoice-archive-options-input.model';
import { InvoicingOptions } from './invoicing-options.model';

/**
 * Input for creating invoicing options. With `archive`, the documents of issued invoices are archived.
 */
export type InvoicingOptionsInput = Partial<Omit<InvoicingOptions, 'archive'>> & {
    /**
     * How the pdf and the electronic invoice of each invoice and credit note are archived once it is issued. None
     * are archived without it.
     */
    readonly archive?: InvoiceArchiveOptionsInput
};
