import { type BigNumber } from '../../../utilities/number.utilities';
import { type Invoice } from '../../invoicing/models/invoice.model';
import { type BankTransaction } from './bank-transaction.model';

/**
 * A transaction and an invoice it may pay, with what of each is open, as the matching scores them.
 */
export type BankMatchCandidate = {
    /**
     * The transaction.
     */
    transaction: BankTransaction,
    /**
     * What of the transaction is not matched yet.
     */
    transactionOpen: BigNumber,
    /**
     * The invoice.
     */
    invoice: Invoice,
    /**
     * What of the invoice is open.
     */
    invoiceOpen: BigNumber,
    /**
     * The recipients the IBAN of the counterparty paid invoices of before, by `BankMatchUtilities.resolveRecipientKey`.
     */
    recipientsPaidByIban: ReadonlySet<string>
};