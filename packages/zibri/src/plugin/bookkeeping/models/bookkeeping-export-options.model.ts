import { type BookkeepingExportOptionsModel } from 'zibri-contract';

/**
 * What the export of a fiscal year holds beside its tables: with `documents` false, the documents archived at the
 * issue of the invoices, the receipts of the expenses, the files of the bank statements and the statements archived
 * at the closing are left out, and the columns naming them are empty. True by default.
 */
export type BookkeepingExportOptions = BookkeepingExportOptionsModel;