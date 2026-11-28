import { BigNumber } from '../../../utilities/number.utilities';
import { Invoice } from '../models/invoice.model';

/**
 * Something that knows what was paid of invoices, such as the matches of the bank plugin. Registered with the variant
 * `INVOICE_PAYMENT_SOURCE_DI_VARIANT`, and asked by the invoice payment service, which adds up what every source
 * answers.
 */
export interface InvoicePaymentSourceInterface {
    /**
     * Resolves what was paid of each of the given invoices of the active tenant.
     * @param invoices - The invoices.
     * @returns What was paid, by the id of the invoice, with no entry for an invoice nothing was paid of. Undefined when
     * the source tracks no payments, such as the bank plugin without `matching`.
     */
    resolvePaidAmounts: (invoices: Invoice[]) => Promise<Map<string, BigNumber> | undefined>
}