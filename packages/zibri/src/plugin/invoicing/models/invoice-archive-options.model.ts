import { type ArchiveRetention } from '../../../archive/archive-retention.model';
import { type LocaleCode } from '../../../localization/models/locale-code.model';
import { type InvoiceConformance } from '../services/conformance/invoice-conformance-service.interface';
import { type Invoice } from './invoice.model';

/**
 * How the documents of issued invoices and credit notes are archived: the pdf, and the electronic invoice, of each,
 * rendered once as it is issued.
 */
export type InvoiceArchiveOptions = {
    /**
     * The name of the file store the documents are kept in, such as `'invoices'`.
     */
    readonly store: string,
    /**
     * The locale the pdf of an issued invoice is rendered in, such as `'de'`.
     */
    readonly locale: LocaleCode,
    /**
     * The electronic invoice an invoice is archived as, such as `'x-rechnung'`, which its pdf carries and which is
     * archived beside it, or undefined for the pdf alone.
     */
    readonly resolveConformance: (invoice: Invoice) => InvoiceConformance | undefined,
    /**
     * How long each document is kept, counted from the end of the calendar year the invoice was issued in.
     * @default { years: 8 }
     */
    readonly retention: ArchiveRetention
};
