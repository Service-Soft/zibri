import { type BookkeepingExportColumnType } from './bookkeeping-export-column-type.enum';

/**
 * A column of a table of the export of a fiscal year.
 */
export type BookkeepingExportColumn = {
    /**
     * The name of the column, such as `postingDate`.
     */
    name: string,
    /**
     * What the column holds, in the language of the request.
     */
    description: string,
    /**
     * What kind of value it holds.
     */
    type: BookkeepingExportColumnType,
    /**
     * How many decimals a number of the column is written with, such as 2 for an amount in EUR. 0 by default.
     */
    decimals?: number
};