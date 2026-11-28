import { type ArchiveRetention } from '../../../archive/archive-retention.model';
import { type TenantsWithoutBooksOptions } from './tenants-without-books.type';

/**
 * Configuration for the bookkeeping plugin: what a tenant without bookkeeping settings does, and how long the journal
 * and the receipts are kept.
 */
export type BookkeepingPluginOptions = TenantsWithoutBooksOptions & {
    /**
     * How long each journal entry and its lines are kept, counted from the end of the calendar year the fiscal year of
     * the entry ends in.
     * @default { years: 10 }
     */
    readonly retention: ArchiveRetention,
    /**
     * The name of the file store the receipts of expenses are kept in.
     * @default 'receipts', EXPENSE_RECEIPT_FILE_STORE_NAME
     */
    readonly receiptStore: string,
    /**
     * How long each receipt of an expense is kept, counted from the end of the year it was uploaded in.
     * @default { years: 8 }
     */
    readonly receiptRetention: ArchiveRetention
};