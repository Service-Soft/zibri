/**
 * Columns of a row and their values, as text, null for a null.
 */
export type PostgresChangeRow = {
    /**
     * The names of the columns.
     */
    columns: string[],
    /**
     * The values, one per column in the same order.
     */
    values: (string | null)[]
};

/**
 * One line of what a backup of a postgres data source that read only what changed holds, as JSON. Tables
 * and sequences are named without their schema, which a restore puts them in.
 */
export type PostgresChangeLine = {
    /**
     * The first line, saying how the lines after it are written.
     */
    kind: 'header',
    /**
     * The version of the format the lines after it are written in.
     */
    formatVersion: number
} | {
    /**
     * A row inserted.
     */
    kind: 'insert',
    /**
     * The table the row is inserted into.
     */
    table: string,
    /**
     * The inserted row.
     */
    row: PostgresChangeRow
} | {
    /**
     * A row's columns set, the ones not sent left as they are.
     */
    kind: 'update',
    /**
     * The table the row is in.
     */
    table: string,
    /**
     * The columns naming the row, with their values before the update.
     */
    key: PostgresChangeRow,
    /**
     * The columns set and their new values.
     */
    row: PostgresChangeRow
} | {
    /**
     * A row deleted.
     */
    kind: 'delete',
    /**
     * The table the row is deleted from.
     */
    table: string,
    /**
     * The columns naming the deleted row, with their values.
     */
    key: PostgresChangeRow
} | {
    /**
     * Tables truncated.
     */
    kind: 'truncate',
    /**
     * The truncated tables.
     */
    tables: string[],
    /**
     * Whether the truncate cascades to the tables referencing them.
     */
    cascade: boolean,
    /**
     * Whether the sequences the tables own are restarted.
     */
    restartIdentity: boolean
} | {
    /**
     * A table read in full: its rows are replaced by the `rows` lines after it.
     */
    kind: 'clear',
    /**
     * The table whose rows are replaced.
     */
    table: string
} | {
    /**
     * Rows of a table read in full.
     */
    kind: 'rows',
    /**
     * The table the rows belong to.
     */
    table: string,
    /**
     * The names of the columns.
     */
    columns: string[],
    /**
     * The rows, each with one value per column in the same order.
     */
    values: (string | null)[][]
} | {
    /**
     * The state of a sequence.
     */
    kind: 'sequence',
    /**
     * The name of the sequence.
     */
    sequence: string,
    /**
     * The sequence's last value, as text.
     */
    lastValue: string,
    /**
     * Whether the last value was handed out, so the next call returns the value after it.
     */
    isCalled: boolean
};