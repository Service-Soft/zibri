import { createHash } from 'node:crypto';

import { toSnakeCase } from '../utilities/to-snake-case.function.ts';

/**
 * Builds the name of the unique constraint covering the given columns.
 *
 * Deterministic on purpose. Left to itself the storage generates a hashed name that nothing else can
 * reproduce, and both the data source keeping the uniques an entity declares and an upsert naming one
 * as its conflict target have to arrive at the same string the schema used.
 * @param tableName - The table the constraint belongs to.
 * @param columns - The property names covered by the constraint, in the order they were declared.
 * @param predicate - The condition of the rows it covers, for a unique over only some of them. A short
 * hash of it ends the name, so that the same columns over other rows are another unique.
 * @returns The constraint name.
 */
export function uniqueConstraintName(tableName: string, columns: string[], predicate?: string): string {
    const name: string = `uq_${tableName}_${columns.map(c => toSnakeCase(c)).join('_')}`;
    if (predicate == undefined) {
        return name;
    }
    const hash: string = createHash('sha256')
        .update(predicate)
        .digest('hex')
        .slice(0, 8);
    return `${name}_${hash}`;
}