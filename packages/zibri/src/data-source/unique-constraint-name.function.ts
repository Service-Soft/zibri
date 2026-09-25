import { toSnakeCase } from '../utilities/to-snake-case.function';

/**
 * Builds the name of the unique constraint covering the given columns.
 *
 * Deterministic on purpose. Left to itself the storage generates a hashed name that nothing else can
 * reproduce, and both a migration adding or dropping the constraint and an upsert naming it as its
 * conflict target have to arrive at the same string the schema used.
 * @param tableName - The table the constraint belongs to.
 * @param columns - The property names covered by the constraint, in the order they were declared.
 * @returns The constraint name.
 */
export function uniqueConstraintName(tableName: string, columns: string[]): string {
    return `uq_${tableName}_${columns.map(c => toSnakeCase(c)).join('_')}`;
}