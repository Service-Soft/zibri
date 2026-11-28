import { type ArchiveRetention } from '../../../archive/archive-retention.model';
import { type BankMatchingOptions } from './bank-matching-options.model';

/**
 * Configuration for the bank plugin.
 */
export type BankPluginOptions = {
    /**
     * The name of the file store the original file of each statement is kept in.
     * @default 'bank-statements', BANK_STATEMENT_FILE_STORE_NAME
     */
    readonly store: string,
    /**
     * How long each statement and its original file are kept, counted from the end of the year the bank created the
     * statement in.
     * @default { years: 8 }
     */
    readonly retention: ArchiveRetention,
    /**
     * Matches the transactions received with the invoices of the invoicing plugin, as approval requests of the approval
     * plugin. No transaction is matched when it is not given.
     */
    readonly matching?: BankMatchingOptions
};