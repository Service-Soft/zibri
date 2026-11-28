import { type BankTransactionStatus } from './bank-transaction-status.enum';

/**
 * What `GET /bank/transactions` takes in its query: a page of the transactions, the latest booking first, narrowed by
 * what is given. It answers a `PaginationResult` of `BankTransactionDetailsModel`, with the count of every transaction
 * matching.
 */
export type BankTransactionQueryModel = {
    /**
     * The page, counting from 1.
     */
    page: number,
    /**
     * How many transactions a page holds, at most 100.
     */
    limit: number,
    /**
     * Only the transactions of this bank account.
     */
    accountId?: string,
    /**
     * Only the transactions first imported with this statement.
     */
    statementId?: string,
    /**
     * Only the transactions booked on this day or after, such as `2026-01-01`.
     */
    from?: Date,
    /**
     * Only the transactions booked on this day or before, such as `2026-12-31`. On or after `from`.
     */
    until?: Date,
    /**
     * Only the transactions with something left to match, `OPEN`, or those matched in full, `MATCHED`.
     */
    status?: BankTransactionStatus
};
