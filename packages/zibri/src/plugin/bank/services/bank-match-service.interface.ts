import { type KeptRowCheckInterface } from '../../../backup/kept-row-check.interface';
import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type ApprovalRequestDetails } from '../../approval/models/approval-request-details.model';
import { type ApprovalRunContext } from '../../approval/models/approval-run-context.model';
import { type InvoicePaymentSourceInterface } from '../../invoicing/services/invoice-payment-source.interface';
import { type BankMatchFilter } from '../models/bank-match-filter.model';
import { type BankMatchInput } from '../models/bank-match-input.model';
import { type BankMatchTarget } from '../models/bank-match-target.model';
import { type BankMatchTargetType } from '../models/bank-match-target-type.enum';
import { type BankMatch } from '../models/bank-match.model';
import { type BankTransactionDetails } from '../models/bank-transaction-details.model';
import { type BankTransactionFilter } from '../models/bank-transaction-filter.model';
import { type BankTransactionState } from '../models/bank-transaction-state.model';
import { type BankTransactionSuggestion } from '../models/bank-transaction-suggestion.model';
import { type BankTransaction } from '../models/bank-transaction.model';
import { type BigNumber } from '../../../utilities/number.utilities';

/**
 * Matches the transactions of the bank accounts of the current tenant with the invoices they pay, and with what the
 * matchers of `BANK_MATCHER_DI_VARIANT` match them with: suggests matches as approval requests of the action
 * `bank.match`, records those approved, reverses them, and answers what is paid of each invoice from them. Finds the
 * matches standing whose invoice is gone or a draft again, such as after a restore of a tenant, which keeps the matches
 * as they are.
 */
export interface BankMatchServiceInterface extends InvoicePaymentSourceInterface, KeptRowCheckInterface {
    /**
     * Suggests the invoices that money received pays, each as an approval request of the action `bank.match`,
     * proposed by the system `bank-matching`, and then what the matchers suggest for what is left. A pair that is
     * pending or was rejected is not suggested again, and what a suggestion matches never exceeds what of the
     * transaction or its target is open.
     * @param transactionIds - The transactions to suggest matches for. Every transaction that is not matched in full by
     * default.
     * @returns The requests proposed, with the decision of those a policy approved.
     * @throws An InternalError when `matching` of the bank plugin options is not set.
     */
    suggestMatches: (transactionIds?: string[]) => Promise<ApprovalRequestDetails[]>,
    /**
     * Records a match, as the action `bank.match` does once its request is approved, and hands it to the postings of
     * `BANK_MATCH_POSTING_DI_VARIANT` in the same transaction. A match leaving an invoice open by at most
     * `paymentDifferenceTolerance` records the rest as its difference, and the invoice counts as paid.
     * @param input - The transaction, the target and the amount.
     * @param context - The transaction to write in, the request and who approved it.
     * @returns The match.
     * @throws A ConflictError when the amount exceeds what of the transaction or the target is open, or the
     * transaction cannot be matched with the target, such as one in another currency.
     */
    createMatch: (input: BankMatchInput, context: ApprovalRunContext) => Promise<BankMatch>,
    /**
     * Reverses a match: records a match of the negative amount, referencing it, and hands it to the postings of
     * `BANK_MATCH_POSTING_DI_VARIANT` in the same transaction. A match is reversed at most once, and a reversal is not
     * reversed.
     * @param matchId - The id of the match.
     * @param reversedBy - The id of the user who reverses it.
     * @param transaction - The transaction to write in, one of its own by default.
     * @returns The match reversing the other.
     * @throws A ConflictError for a match reversed already, or a reversal.
     */
    reverseMatch: (matchId: string, reversedBy: string, transaction?: Transaction) => Promise<BankMatch>,
    /**
     * Resolves a target other than an invoice a transaction is about to be matched with, through the matcher of its
     * type.
     * @param targetType - The type of the target.
     * @param targetId - The id of the target.
     * @param bankTransaction - The transaction.
     * @param transaction - The transaction of the data source to read in, if any.
     * @returns The target.
     * @throws A ConflictError when no matcher of the type is registered, or the transaction cannot be matched with it.
     */
    resolveTarget: (
        targetType: BankMatchTargetType,
        targetId: string,
        bankTransaction: BankTransaction,
        transaction?: Transaction
    ) => Promise<BankMatchTarget>,
    /**
     * Finds a page of the matches the filter matches, the latest confirmed first.
     */
    findMatches: (page: number, limit: number, filter: BankMatchFilter) => Promise<PaginationResult<BankMatch>>,
    /**
     * Finds a page of the transactions the filter matches, the latest booking first, each with what of it is not
     * matched yet, and how many match.
     * @param page - The page, counting from 1.
     * @param limit - How many transactions a page holds.
     * @param filter - The account, the statement, the days `from` to `until` they were booked on, and whether they are
     * open or matched in full.
     * @returns The page.
     * @throws A BadRequestError for a `from` or `until` with a time, or an `until` before `from`.
     */
    findTransactionDetails: (page: number, limit: number, filter: BankTransactionFilter) => Promise<PaginationResult<BankTransactionDetails>>,
    /**
     * Finds the pending suggestions of a transaction: the approval requests of `bank.match` waiting for a decision,
     * the most likely first, each with the difference within `paymentDifferenceTolerance` it would record of an
     * invoice. None without `matching` of the bank plugin options.
     * @param transactionId - The id of the transaction.
     * @returns The suggestions.
     * @throws A NotFoundError for a transaction the active tenant does not have.
     */
    findSuggestions: (transactionId: string) => Promise<BankTransactionSuggestion[]>,
    /**
     * Resolves what of each transaction is not matched yet, whichever its direction: its amount without its sign, less
     * its confirmed matches, a reversal adding back what it reverses.
     * @param transactions - The transactions.
     * @param transaction - The transaction to read the matches in, of the data source of `BankMatch`, if any.
     * @returns What of each is open, by its id.
     */
    resolveTransactionOpenAmounts: (
        transactions: Pick<BankTransaction, 'id' | 'amount'>[],
        transaction: Transaction | undefined
    ) => Promise<Map<string, BigNumber>>,
    /**
     * Recomputes the state of transactions from the transactions and their matches, and writes each that differs or
     * is missing. Without a transaction, a page of transactions at a time, each in a transaction of its own under the
     * lease the matches are written under. With one, in it, which holds that lease or the matches of the transactions
     * are written in.
     * @param transactionIds - The transactions, every one of the active tenant by default.
     * @param transaction - The transaction to write in, of the data source of the transactions, if any.
     * @returns The states written, none when every state held.
     */
    recomputeTransactionStates: (transactionIds?: string[], transaction?: Transaction) => Promise<BankTransactionState[]>
}
