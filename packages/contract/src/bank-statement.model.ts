import { type ArchivedFileModel } from './archived-file.model';
import { type FileReference } from './file-reference.model';

/**
 * A statement of a bank account, imported from a CAMT.053 file, as `GET /bank/statements` and
 * `POST /bank/statements` answer it. Amounts are decimal strings, such as `'1250.00'`, negative below zero.
 */
export type BankStatementModel = {
    /**
     * The id of the statement.
     */
    id: string,
    /**
     * The tenant the statement belongs to.
     */
    tenantId: string,
    /**
     * The place of the statement in the chain of the archived rows of its tenant.
     */
    chainSequence: number,
    /**
     * The hash linking the statement to the row before it in its chain.
     */
    chainHash: string,
    /**
     * When the retention of the statement ends, from which it may be deleted.
     */
    retainUntil: Date,
    /**
     * The original file, with its SHA-256, as it was when the statement was imported.
     */
    archivedFiles: ArchivedFileModel[],
    /**
     * The id of the bank account the statement is of.
     */
    accountId: string,
    /**
     * The id the bank gave the statement. Unique among the statements of its account.
     */
    bankStatementId: string,
    /**
     * The number the bank counts the statements of the account with, if it names one.
     */
    electronicSequenceNumber?: number | null,
    /**
     * When the bank created the statement.
     */
    issuedAt: Date,
    /**
     * The start of the period the statement covers.
     */
    periodStart: Date,
    /**
     * The end of the period the statement covers.
     */
    periodEnd: Date,
    /**
     * The booked balance at the start of the period.
     */
    openingBalance: string,
    /**
     * The date of the opening balance.
     */
    openingBalanceDate: Date,
    /**
     * The booked balance at the end of the period, which the next statement opens with.
     */
    closingBalance: string,
    /**
     * The date of the closing balance.
     */
    closingBalanceDate: Date,
    /**
     * The currency of the balances, such as `EUR`.
     */
    currency: string,
    /**
     * The version of CAMT.053 the file is written in: `camt.053.001.02` or `camt.053.001.08`.
     */
    format: string,
    /**
     * The original file the statement was imported from. Null once its row is gone.
     */
    file: FileReference | null,
    /**
     * When the statement was imported.
     */
    importedAt: Date,
    /**
     * The user who imported the statement, or null when no user did.
     */
    importedBy?: string | null
};