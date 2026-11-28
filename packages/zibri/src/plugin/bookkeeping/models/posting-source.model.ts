import { type BankMatch } from '../../bank/models/bank-match.model';
import { type BankTransaction } from '../../bank/models/bank-transaction.model';
import { type Invoice } from '../../invoicing/models/invoice.model';
import { type Expense } from './expense.model';
import { type PostingSourceType } from './posting-source-type.enum';

/**
 * What the posting service posts an entry of: an invoice or a credit note, an expense, or a match of a bank
 * transaction.
 */
export type PostingSource = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: PostingSourceType.INVOICE | PostingSourceType.CREDIT_NOTE,
    /**
     * The invoice, or the credit note, as it is issued.
     */
    invoice: Invoice
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: PostingSourceType.EXPENSE,
    /**
     * The expense, as it is recorded.
     */
    expense: Expense
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: PostingSourceType.BANK_MATCH,
    /**
     * The match, as it is confirmed.
     */
    match: BankMatch,
    /**
     * The transaction it matches.
     */
    bankTransaction: BankTransaction
};