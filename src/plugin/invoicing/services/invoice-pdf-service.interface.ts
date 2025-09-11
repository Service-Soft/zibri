
import { PdfDocument } from '../../../document';
import { Invoice as BaseInvoice } from '../models';
import { InvoiceConformance } from './conformance';

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