import { TableColumn } from 'typeorm';

/**
 * What a column is written as in a statement.
 */
export type PostgresColumnSql = {
    /**
     * The column, quoted.
     */
    name: string,
    /**
     * The column as postgres stores it, for what a value is compared with.
     */
    stored: TableColumn,
    /**
     * Its full type, length and array included.
     */
    type: string
};