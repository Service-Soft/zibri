import { type BankStatement } from '../models/bank-statement.model';
import { CamtTransactionData } from './camt-transaction-data.model';

/**
 * A statement as a CAMT.053 file holds it, with its booked transactions, before it is stored on its account.
 */
export type CamtStatementData = Pick<
    BankStatement,
    'bankStatementId' | 'electronicSequenceNumber' | 'issuedAt' | 'periodStart' | 'periodEnd' | 'openingBalance'
    | 'openingBalanceDate' | 'closingBalance' | 'closingBalanceDate' | 'currency' | 'format'
> & {
    /**
     * The IBAN of the account the statement is of, in capitals and without spaces.
     */
    iban: string,
    /**
     * The booked transactions, in the order of the file. Pending entries are left out.
     */
    transactions: CamtTransactionData[]
};