import { type BookkeepingExportFile } from './bookkeeping-export-file.type';
import { type BookkeepingSettings } from './bookkeeping-settings.model';
import { type BookkeepingVerification } from './bookkeeping-verification.model';
import { type FiscalYear } from './fiscal-year.model';

/**
 * What the export of a fiscal year holds, as an exporter writes it into an archive of its format.
 */
export type BookkeepingExportContent = {
    /**
     * The fiscal year.
     */
    fiscalYear: FiscalYear,
    /**
     * The settings of the books, with their currency and company.
     */
    settings: BookkeepingSettings,
    /**
     * When the export was started.
     */
    exportedAt: Date,
    /**
     * What checking the books of the tenant found as the export was started: whether the chains of its entries and
     * lines hold, and every entry balances.
     */
    verification: BookkeepingVerification,
    /**
     * The files, read once and in order: the tables, then the documents, then the tables of what checking the books
     * and reading the documents found. Each table's rows are read before the next file.
     */
    files: AsyncIterable<BookkeepingExportFile>
};