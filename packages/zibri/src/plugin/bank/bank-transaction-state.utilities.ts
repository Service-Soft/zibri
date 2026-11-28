import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { BankTransactionStatus } from './models/bank-transaction-status.enum';
import { type BankTransactionState, type BankTransactionStateCreateData } from './models/bank-transaction-state.model';
import { type BankTransaction } from './models/bank-transaction.model';

/**
 * Derives the state of a bank transaction, what of it is left to match, from the transaction and what of it is open.
 */
export abstract class BankTransactionStateUtilities {
    /**
     * Resolves the state of a transaction.
     * @param transaction - The transaction.
     * @param openAmount - What of it is not matched yet, without its sign.
     * @returns The state, `MATCHED` once nothing of it is open.
     */
    static resolveState(
        transaction: Pick<BankTransaction, 'id' | 'accountId' | 'statementId' | 'bookingDate'>,
        openAmount: BigNumber
    ): BankTransactionStateCreateData {
        return {
            transactionId: transaction.id,
            accountId: transaction.accountId,
            statementId: transaction.statementId,
            bookingDate: transaction.bookingDate,
            openAmount,
            status: openAmount.isZero() ? BankTransactionStatus.MATCHED : BankTransactionStatus.OPEN
        };
    }

    /**
     * Whether a stored state is the one resolved.
     * @param stored - The state stored.
     * @param resolved - The state as the transaction and its matches make it.
     * @returns True when they hold the same.
     */
    static isSameState(stored: BankTransactionState, resolved: BankTransactionStateCreateData): boolean {
        return stored.transactionId === resolved.transactionId
            && stored.accountId === resolved.accountId
            && stored.statementId === resolved.statementId
            && stored.bookingDate.getTime() === resolved.bookingDate.getTime()
            && NumberUtilities.compare(stored.openAmount, resolved.openAmount) === 0
            && stored.status === resolved.status;
    }
}
