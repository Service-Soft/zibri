import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { Invoice } from '../models/invoice.model';

/**
 * Something that books invoices once they are issued, such as the bookkeeping plugin. Registered with the variant
 * `INVOICE_POSTING_DI_VARIANT`, and handed every invoice a write issues, however the repository got to it.
 */
export interface InvoicePostingInterface {
    /**
     * Posts the invoices and credit notes a write issues, before the write is made and in its transaction, so that
     * one rolled back, or failing, posts nothing. A write issuing an invoice without a transaction runs in one
     * started for it. What it throws refuses the write.
     * @param invoices - The invoices as they are once written, each of its own tenant.
     * @param transaction - The transaction of the write.
     */
    postIssuedInvoices: (invoices: Invoice[], transaction: RepositoryTransaction) => Promise<void>
}