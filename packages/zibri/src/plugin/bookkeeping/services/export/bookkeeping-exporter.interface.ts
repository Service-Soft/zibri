import { type BookkeepingExportArchive } from '../../models/bookkeeping-export-archive.model';
import { type BookkeepingExportContent } from '../../models/bookkeeping-export-content.model';

/**
 * Writes the export of a fiscal year in one format, such as the description standard of the German tax
 * administration for a tax audit.
 */
export interface BookkeepingExporterInterface {
    /**
     * Writes the archive of an export. Nothing is read before the archive is.
     * @param content - What the export holds.
     * @returns The archive, written as it is read.
     */
    resolveArchive: (content: BookkeepingExportContent) => BookkeepingExportArchive
}