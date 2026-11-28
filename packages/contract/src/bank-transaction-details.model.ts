import { type BankTransactionModel } from './bank-transaction.model';

/**
 * A booked transaction with what of it is left to match, as `GET /bank/transactions` answers it.
 */
export type BankTransactionDetailsModel = {
    /**
     * The transaction.
     */
    transaction: BankTransactionModel,
    /**
     * What of the transaction is not matched yet, without its sign: its amount less its confirmed matches, a reversal
     * opening again what it reverses. A decimal string, such as `'69.00'`, and `'0'` for a transaction matched in full.
     */
    openAmount: string
};