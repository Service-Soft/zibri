import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BankMatch } from '../models/bank-match.model';
import { type BankTransaction } from '../models/bank-transaction.model';

/**
 * Something that books the matches of bank transactions, such as the bookkeeping plugin. Registered with the variant
 * `BANK_MATCH_POSTING_DI_VARIANT`, and handed each match in the transaction it is written in, so that one rolled back
 * posts nothing. What it throws refuses the match.
 */
export interface BankMatchPostingInterface {
    /**
     * Posts a match once it is written.
     * @param match - The match.
     * @param bankTransaction - The transaction it matches.
     * @param transaction - The transaction it is written in.
     */
    postMatch: (match: BankMatch, bankTransaction: BankTransaction, transaction: Transaction) => Promise<void>,
    /**
     * Posts the reversal of a match once it is written.
     * @param reversal - The match reversing the other.
     * @param original - The match it reverses.
     * @param transaction - The transaction it is written in.
     */
    postMatchReversal: (reversal: BankMatch, original: BankMatch, transaction: Transaction) => Promise<void>
}
