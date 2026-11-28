import { type BookkeepingExportColumn } from './bookkeeping-export-column.model';
import { type BookkeepingExportForeignKey } from './bookkeeping-export-foreign-key.model';
import { type BookkeepingExportValue } from './bookkeeping-export-value.type';

/**
 * A table of the export of a fiscal year, such as its journal entries, with its rows.
 */
export type BookkeepingExportTable = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    kind: 'table',
    /**
     * The name of the table, such as `journal-entries`, which names its file.
     */
    name: string,
    /**
     * What the table holds, in the language of the request.
     */
    description: string,
    /**
     * Its columns, in the order of the values of each row.
     */
    columns: BookkeepingExportColumn[],
    /**
     * The column identifying each row, its first column, such as `id`, or undefined for none.
     */
    primaryKey: string | undefined,
    /**
     * The columns holding the ids of rows of other tables.
     */
    foreignKeys: BookkeepingExportForeignKey[],
    /**
     * Its rows, each a value per column, read once, after the rows of every table before it.
     */
    rows: AsyncIterable<BookkeepingExportValue[]>
};
