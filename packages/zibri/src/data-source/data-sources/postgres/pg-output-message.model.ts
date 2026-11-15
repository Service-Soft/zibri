/**
 * A value of a row as pgoutput sends it: null, a TOASTed value an update left unchanged and so did not
 * send, or its text.
 */
export type PgOutputValue = {
    /**
     * The value is null.
     */
    kind: 'null'
} | {
    /**
     * The value is a TOASTed one the update left unchanged and did not send.
     */
    kind: 'unchanged'
} | {
    /**
     * The value is sent as text.
     */
    kind: 'text',
    /**
     * The value in postgres's text form.
     */
    text: string
};

/**
 * A column of a table as pgoutput describes it.
 */
export type PgOutputColumn = {
    /**
     * The name of the column.
     */
    name: string,
    /**
     * Whether it is part of the replica identity, which an update or a delete names its row by.
     */
    key: boolean
};

/**
 * The description of a table, sent before the first change of it in a session and after it changed.
 */
export type PgOutputRelation = {
    /**
     * The message describes a table.
     */
    kind: 'relation',
    /**
     * The id later messages name the table by.
     */
    relationId: number,
    /**
     * The schema the table is in.
     */
    schema: string,
    /**
     * The name of the table.
     */
    table: string,
    /**
     * The columns of the table, in the order a message sends their values.
     */
    columns: PgOutputColumn[]
};

/**
 * One message of the pgoutput plugin, protocol version 1, as far as a backup reads it.
 */
export type PgOutputMessage = {
    /**
     * A transaction starts.
     */
    kind: 'begin',
    /**
     * Where the transaction's commit is in the WAL.
     */
    finalLsn: bigint
} | {
    /**
     * A transaction ends.
     */
    kind: 'commit'
} | PgOutputRelation | {
    /**
     * A row is inserted.
     */
    kind: 'insert',
    /**
     * The id of the table the row is inserted into.
     */
    relationId: number,
    /**
     * The values of the new row, one per column.
     */
    values: PgOutputValue[]
} | {
    /**
     * A row is updated.
     */
    kind: 'update',
    /**
     * The id of the table the row is in.
     */
    relationId: number,
    /**
     * The row's replica identity before the update, when the update changed it.
     */
    oldValues: PgOutputValue[] | undefined,
    /**
     * The values of the row after the update, one per column.
     */
    values: PgOutputValue[]
} | {
    /**
     * A row is deleted.
     */
    kind: 'delete',
    /**
     * The id of the table the row is deleted from.
     */
    relationId: number,
    /**
     * The replica identity of the deleted row.
     */
    oldValues: PgOutputValue[]
} | {
    /**
     * Tables are truncated.
     */
    kind: 'truncate',
    /**
     * The ids of the truncated tables.
     */
    relationIds: number[],
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
     * What a backup does not read: an origin, a type, a logical message.
     */
    kind: 'other'
};