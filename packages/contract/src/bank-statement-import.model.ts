import { type BankStatementModel } from './bank-statement.model';

/**
 * What importing a CAMT.053 file stored, as `POST /bank/statements` answers it.
 */
export type BankStatementImportModel = {
    /**
     * The statements of the file that were stored.
     */
    statements: BankStatementModel[],
    /**
     * How many statements of the file were skipped, as imported before or holding no transaction that was not.
     */
    skippedStatementCount: number,
    /**
     * How many transactions were stored.
     */
    transactionCount: number,
    /**
     * How many booked transactions of the file were skipped as imported before.
     */
    skippedTransactionCount: number
};