import { type InvoicePaymentState } from '../models/invoice-payment-state.model';
import { Invoice } from '../models/invoice.model';

/**
 * Resolves what of invoices is paid and what is open, from their credit notes and what the payment sources registered
 * with `INVOICE_PAYMENT_SOURCE_DI_VARIANT` know as paid.
 */
export interface InvoicePaymentServiceInterface {
    /**
     * Resolves the payment state of an invoice of the active tenant.
     * @param invoice - The invoice.
     * @returns Its total, what is credited, paid and open, and how far it is paid. Undefined when no payment source
     * tracks payments.
     */
    resolvePaymentState: (invoice: Invoice) => Promise<InvoicePaymentState | undefined>,
    /**
     * Resolves the payment states of invoices of the active tenant at once.
     * @param invoices - The invoices.
     * @returns The state of each invoice, in the order of the invoices. Undefined when no payment source tracks
     * payments.
     */
    resolvePaymentStates: (invoices: Invoice[]) => Promise<InvoicePaymentState[] | undefined>
}