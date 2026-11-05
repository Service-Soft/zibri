/**
 * A type a column can be declared as, as postgres names it.
 */
export type ColumnType = 'bigint'
    | 'boolean'
    | 'bytea'
    | 'character varying'
    | 'date'
    | 'double precision'
    | 'integer'
    | 'json'
    | 'jsonb'
    | 'numeric'
    | 'real'
    | 'smallint'
    | 'text'
    | 'timestamp with time zone'
    | 'timestamp without time zone'
    | 'uuid';