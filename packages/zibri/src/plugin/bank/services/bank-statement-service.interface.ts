import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { type BankStatementFile } from '../models/bank-statement-file.model';
import { type BankStatementImport } from '../models/bank-statement-import.model';

/**
 * Imports the statements of CAMT.053 files into the bank accounts of the current tenant.
 */
export interface BankStatementServiceInterface {
    /**
     * Imports every statement of a CAMT.053 file, of the versions `camt.053.001.02` and `camt.053.001.08`, with its
     * booked transactions, and keeps the file with each statement it stores. A file can hold several statements, of
     * several accounts. Pending entries are left out.
     *
     * A statement imported before is skipped, and so is a transaction: each transaction of an account is stored once,
     * however many files hold it. Nothing is stored when any statement of the file is refused.
     *
     * With `matching` of the bank plugin options, the invoices the transactions of money received pay are suggested
     * once the import is committed, see `suggestMatches` of the bank match service.
     * @param file - The file.
     * @param transaction - The transaction to import in, of the data source of the bank plugin's entities. One of its
     * own by default.
     * @returns What was stored, and what was skipped.
     * @throws A BadRequestError for a file that is not a CAMT.053 file of those versions, or whose booked entries do not
     * add up from the opening to the closing balance of their statement.
     * @throws A ConflictError for a statement of an IBAN the tenant has no bank account of, in another currency than
     * its account, or whose opening balance does not continue from the closing balance of the statement imported
     * before it.
     */
    importStatements: (file: BankStatementFile, transaction?: Transaction) => Promise<BankStatementImport>
}