import { queryPostgres } from './query-postgres.function';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-data-source.model';

/**
 * A column as postgres stores it.
 */
export type StoredColumn = {
    /**
     * Its type, without being an array.
     */
    type: string,
    /**
     * Whether it holds a list of its type.
     */
    isArray: boolean,
    /**
     * Whether it may hold no value.
     */
    nullable: boolean
};

/**
 * Reads the columns of a table as postgres stores them, for a test about what the schema declares.
 * @param dataSource - The data source.
 * @param table - The table.
 * @returns Each column, by name.
 */
export async function findStoredColumns(dataSource: PostgresDataSource, table: string): Promise<Map<string, StoredColumn>> {
    const rows: Record<string, unknown>[] = await queryPostgres(
        dataSource,
        'SELECT a.attname AS "name", format_type(a.atttypid, NULL) AS "type", t.typcategory = \'A\' AS "isArray",'
        + ' NOT a.attnotnull AS "nullable"'
        + ' FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace'
        + ' JOIN pg_type t ON t.oid = a.atttypid'
        + ' WHERE n.nspname = current_schema() AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped',
        [table]
    );
    return new Map(rows.map(row => {
        const type: string = String(row['type']);
        const isArray: boolean = row['isArray'] === true;
        return [String(row['name']), { type: isArray ? type.replace(/\[]$/, '') : type, isArray, nullable: row['nullable'] === true }];
    }));
}