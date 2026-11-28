import { type Readable } from 'node:stream';

import { type KeptRowCheckInterface } from '../../../backup/kept-row-check.interface';
import { type PdfPageSize } from '../../../document/pdf.utilities';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { type LocaleCode } from '../../../localization/models/locale-code.model';
import { type Timezone } from '../../../localization/models/timezone.model';
import { type InvoiceDocument } from '../models/invoice-document.model';
import { type Invoice } from '../models/invoice.model';
import { type InvoiceConformance } from './conformance/invoice-conformance-service.interface';

/**
 * Keeps the documents of issued invoices and credit notes: archives the pdf and the electronic invoice of each as it
 * is issued, with the `archive` of the invoicing options, and answers the archived copy of an issued invoice, and a
 * rendered one of any other. Finds the documents whose invoice is gone or a draft again, such as after a restore of a
 * tenant, which keeps the documents as they are archived.
 */
export interface InvoiceDocumentServiceInterface extends KeptRowCheckInterface {
    /**
     * Renders the pdf and the electronic invoice of each invoice a write issues and archives them, before the write is
     * made and in its transaction, so that a write rolled back or failing archives nothing. Does nothing without the
     * `archive` of the invoicing options.
     * @param invoices - The invoices as they are once written, each of its own tenant.
     * @param transaction - The transaction of the write.
     * @throws What rendering an invoice fails with, which refuses the write.
     */
    archiveIssuedInvoices: (invoices: Invoice[], transaction: RepositoryTransaction) => Promise<void>,
    /**
     * Finds the documents archived of an invoice of the current tenant.
     * @param invoiceId - The id of the invoice.
     * @returns The documents, or undefined for an invoice of which none are archived, such as a draft.
     */
    findDocument: (invoiceId: string) => Promise<InvoiceDocument | undefined>,
    /**
     * Resolves the pdf of an invoice of the current tenant: of an issued one the pdf archived at its issue, the same
     * bytes every time whatever the arguments, and of any other one the pdf rendered with them.
     * @param invoice - The invoice.
     * @param locale - The locale a pdf is rendered in.
     * @param timezone - The time zone the dates of a pdf rendered are read in.
     * @param conformance - The electronic invoice a pdf rendered carries, if any.
     * @param pageSize - The size of the pages of a pdf rendered, the `pageSize` of the options when undefined.
     * @returns The pdf.
     */
    resolvePdf: (
        invoice: Invoice,
        locale: LocaleCode,
        timezone: Timezone,
        conformance: InvoiceConformance | undefined,
        pageSize: PdfPageSize | undefined
    ) => Promise<Readable>,
    /**
     * Resolves the xml of the electronic invoice of an invoice of the current tenant: of an issued one the xml
     * archived at its issue, and of any other one the xml the conformance writes.
     * @param invoice - The invoice.
     * @param conformance - The electronic invoice written of one that is not archived, such as `'x-rechnung'`.
     * @param timezone - The time zone the dates of an xml written are read in.
     * @returns The xml.
     * @throws A NotFoundError for an issued invoice archived without an electronic invoice.
     * @throws An InternalError for a conformance that writes no xml of its own.
     */
    resolveElectronicInvoice: (invoice: Invoice, conformance: InvoiceConformance, timezone: Timezone) => Promise<Readable>
}
