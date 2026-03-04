import { InvoiceConformance } from './conformance/invoice-conformance-service.interface';
import { PdfDocument } from '../../../document/pdf.utilities';
import { Invoice as BaseInvoice } from '../models/invoice.model';

/**
 * Handles generating pdf invoice files.
 */
export interface InvoicePdfServiceInterface<Invoice extends BaseInvoice> {
    /**
     * Creates a pdf for the provided invoice.
     * @param invoice - The invoice to create the pdf for.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    generateInvoicePdf: (invoice: Invoice, conformance: InvoiceConformance, ...args: any[]) => PdfDocument | Promise<PdfDocument>
}