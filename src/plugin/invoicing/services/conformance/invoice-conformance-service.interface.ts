import { PdfDocument, PdfDocumentDefinition } from '../../../../document';
import { Invoice as BaseInvoice } from '../../models';

/**
 * Defines the different conformance types.
 * Is loosely typed so that a custom string can be provided.
 */
export type InvoiceConformance = 'x-rechnung' | 'peppol' | string & {};

/**
 * Interface for a service that handles updating an invoice pdf in a way that it conforms to a certain standard like X-Rechnung.
 */
export interface InvoiceConformanceServiceInterface<Invoice extends BaseInvoice> {
    /**
     * The name of the conformance that is handled by this service.
     */
    readonly name: InvoiceConformance,
    /**
     * Updates the given pdf document definition.
     */
    updateDocumentDefinition: (invoice: Invoice, definition: PdfDocumentDefinition) => void | Promise<void>,
    /**
     * Updates the given finished pdf document.
     */
    updateDocument: (doc: PdfDocument) => void | Promise<void>
}