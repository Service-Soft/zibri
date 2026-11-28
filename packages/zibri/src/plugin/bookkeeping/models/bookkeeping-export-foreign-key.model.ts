/**
 * A column of a table of the export that holds the id of a row of another table, such as the `accountId` of a line.
 */
export type BookkeepingExportForeignKey = {
    /**
     * The column, such as `accountId`.
     */
    column: string,
    /**
     * The name of the table whose `id` it holds, such as `accounts`.
     */
    table: string
};
