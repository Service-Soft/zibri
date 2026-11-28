import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { CreditNoteData } from '../models/credit-note-data.model';
import { InvoiceItem } from '../models/invoice-item.model';
import { Invoice as BaseInvoice } from '../models/invoice.model';

/**
 * Corrects issued invoices with credit notes: documents of type `CREDIT_NOTE` that reference the invoice they
 * correct, and state what they credit of it in positive amounts.
 */
export interface InvoiceCancellationServiceInterface<Invoice extends BaseInvoice> {
    /**
     * Cancels an invoice of the active tenant: creates a credit note of all its items.
     * @param invoiceId - The id of the invoice.
     * @param data - What the credit note states besides its items.
     * @param transaction - An optional transaction from outside, which the number of the credit note rolls back with.
     * @returns The credit note, numbered and issued.
     * @throws A ConflictError when part of the invoice is credited already, or it is a credit note or a draft.
     */
    cancelInvoice: (
        invoiceId: string,
        data?: CreditNoteData,
        transaction?: RepositoryTransaction
    ) => Invoice | Promise<Invoice>,
    /**
     * Credits a part of an invoice of the active tenant: creates a credit note of the given items.
     * @param invoiceId - The id of the invoice.
     * @param items - What is credited, at positive prices.
     * @param data - What the credit note states besides its items.
     * @param transaction - An optional transaction from outside, which the number of the credit note rolls back with.
     * @returns The credit note, numbered and issued.
     * @throws A ConflictError when it credits more of a VAT rate than the invoice has not yet credited, or the
     * invoice is a credit note or a draft.
     */
    createCreditNote: (
        invoiceId: string,
        items: InvoiceItem[],
        data?: CreditNoteData,
        transaction?: RepositoryTransaction
    ) => Invoice | Promise<Invoice>
}