import { InvoiceConformance } from './conformance/invoice-conformance-service.interface';
import { PdfDocument } from '../../../document/pdf.utilities';
import { LocaleCode } from '../../../localization/models/locale-code.model';
import { Timezone } from '../../../localization/models/timezone.model';
import { Invoice as BaseInvoice } from '../models/invoice.model';

/**
 * Handles generating pdf invoice files.
 */
export interface InvoicePdfServiceInterface<Invoice extends BaseInvoice> {
    /**
     * Creates a pdf for the provided invoice.
     *
     * Locale and time zone are both stated by the caller, because both decide how the document reads
     * and neither is a property of the invoice. A document that has to say the same thing to everyone
     * gets the issuer's zone; a copy rendered for one customer can get theirs.
     * @param invoice - The invoice to create the pdf for.
     * @param locale - The locale to render the invoice in.
     * @param timezone - The time zone the invoice's dates are read in, deciding which calendar day each lands on.
     */
    generateInvoicePdf: (
        invoice: Invoice,
        locale: LocaleCode,
        timezone: Timezone,
        conformance: InvoiceConformance,
        // eslint-disable-next-line typescript/no-explicit-any
        ...args: any[]
    ) => PdfDocument | Promise<PdfDocument>
}