import { InvoicingOptions } from './invoicing-options.model';

/**
 * Input for creating invoicing options.
 */
export type InvoicingOptionsInput = Partial<InvoicingOptions> & Pick<InvoicingOptions, 'companyInfo'>;