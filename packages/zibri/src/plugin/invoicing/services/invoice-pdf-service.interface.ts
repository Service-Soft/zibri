import { InvoiceConformance } from './conformance/invoice-conformance-service.interface';
import { PdfDocument } from '../../../document/pdf.utilities';
import { LocaleCode } from '../../../localization/models/locale-code.model';
import { Invoice as BaseInvoice } from '../models/invoice.model';

/**
 * Handles generating pdf invoice files.
 */
export interface InvoicePdfServiceInterface<Invoice extends BaseInvoice> {
    /**
     * Creates a pdf for the provided invoice.
     * @param invoice - The invoice to create the pdf for.
     */
    generateInvoicePdf: (
        invoice: Invoice,
        locale: LocaleCode,
        conformance: InvoiceConformance,
        // eslint-disable-next-line typescript/no-explicit-any
        ...args: any[]
    ) => PdfDocument | Promise<PdfDocument>
}