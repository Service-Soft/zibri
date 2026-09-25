import { toSnakeCase } from '../utilities/to-snake-case.function';

/**
 * Builds the name of the index covering the given columns.
 *
 * Deterministic for the same reason a unique constraint's name is: left to itself the storage
 * generates a hashed name that nothing else can reproduce, and a migration adding or dropping the
 * index has to arrive at the same string the schema used.
 * @param tableName - The table the index belongs to.
 * @param columns - The property names covered by the index, in the order they were declared.
 * @returns The index name.
 */
export function indexName(tableName: string, columns: string[]): string {
    return `idx_${tableName}_${columns.map(c => toSnakeCase(c)).join('_')}`;
}

/**
 * What the name of an index over the trigrams of a column starts with.
 *
 * Exported because the data source that owns these indices finds them by it: everything on one of
 * its tables whose name starts this way is one of its own, and everything else belongs to somebody
 * else and is left alone.
 */
export const TRIGRAM_INDEX_PREFIX: string = 'trgm_';

/**
 * Builds the name of the index over the trigrams of the given column.
 *
 * A prefix of its own rather than a suffix on {@link indexName}, because the data source creates and
 * drops these itself and has to be able to tell which indices on a table are the ones it owns. A
 * column that stops being searchable is a name that is no longer asked for, and nothing else would
 * say that the index left behind was this code's to remove.
 * @param tableName - The table the index belongs to.
 * @param column - The property name whose values are indexed by trigram.
 * @returns The index name.
 */
export function trigramIndexName(tableName: string, column: string): string {
    return `${TRIGRAM_INDEX_PREFIX}${tableName}_${toSnakeCase(column)}`;
}