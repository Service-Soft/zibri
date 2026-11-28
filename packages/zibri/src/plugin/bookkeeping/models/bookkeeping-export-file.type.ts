import { type BookkeepingExportDocument } from './bookkeeping-export-document.model';
import { type BookkeepingExportTable } from './bookkeeping-export-table.model';

/**
 * A file of the export of a fiscal year: a table, or a document.
 */
export type BookkeepingExportFile = BookkeepingExportTable | BookkeepingExportDocument;