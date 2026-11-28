import { OmitStrict } from '../../../types/omit-strict.type';
import { type BankTransaction } from '../models/bank-transaction.model';

/**
 * A booked transaction as a CAMT.053 file holds it, before it is stored on its account.
 */
export type CamtTransactionData = OmitStrict<BankTransaction, 'id' | 'tenantId' | 'accountId' | 'statementId'>;