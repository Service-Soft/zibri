import { type BookkeepingExportArchive } from '../../models/bookkeeping-export-archive.model';
import { type BookkeepingExportOptions } from '../../models/bookkeeping-export-options.model';

/**
 * Exports the books of a fiscal year of the current tenant for a tax audit, in the format of the exporter of
 * `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORTER`.
 */
export interface BookkeepingExportServiceInterface {
    /**
     * Exports a fiscal year: its accounts, journal entries and lines, what posted them, the documents behind them and
     * what checking the books found, which a broken chain does not stop. The rows are read while the archive is,
     * each table once the one before it is written, and the documents one after another, so neither is held in
     * memory. An entry posted into an open fiscal year while it is exported is left out with its lines.
     * @param fiscalYearId - The id of the fiscal year.
     * @param options - Whether the documents are in it.
     * @returns The archive, read in the tenant it was exported in.
     * @throws A NotFoundError for a fiscal year the current tenant does not have.
     * @throws A ConflictError for a tenant without bookkeeping settings.
     */
    exportFiscalYear: (fiscalYearId: string, options?: BookkeepingExportOptions) => Promise<BookkeepingExportArchive>
}
