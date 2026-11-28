import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BankMatchTarget } from '../models/bank-match-target.model';
import { type BankMatchTargetType } from '../models/bank-match-target-type.enum';
import { type BankMatcherSuggestion } from '../models/bank-matcher-suggestion.model';
import { type BankMatcherTransaction } from '../models/bank-matcher-transaction.model';
import { type BankTransaction } from '../models/bank-transaction.model';

/**
 * Matches bank transactions with targets of a type other than an invoice, such as the expenses and the accounts of
 * the bookkeeping plugin. Registered with the variant `BANK_MATCHER_DI_VARIANT`, one per target type.
 */
export interface BankMatcherInterface {
    /**
     * The type of the targets it matches.
     */
    readonly targetType: BankMatchTargetType,
    /**
     * Resolves what the given transactions of the active tenant may be matched with.
     * @param transactions - The transactions, with what of each is left.
     * @returns The suggestions, of any confidence it suggests.
     */
    resolveSuggestions: (transactions: BankMatcherTransaction[]) => Promise<BankMatcherSuggestion[]>,
    /**
     * Resolves a target a transaction is about to be matched with.
     * @param targetId - The id of the target.
     * @param bankTransaction - The transaction.
     * @param transaction - The transaction of the data source to read in, if any.
     * @returns The target.
     * @throws A ConflictError for a target the transaction cannot be matched with, such as an expense in another
     * currency, and a NotFoundError for one the tenant does not have.
     */
    resolveTarget: (targetId: string, bankTransaction: BankTransaction, transaction: Transaction | undefined) => Promise<BankMatchTarget>
}
