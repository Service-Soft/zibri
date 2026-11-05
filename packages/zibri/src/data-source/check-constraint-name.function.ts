import { createHash } from 'node:crypto';

import { type uniqueConstraintName } from './unique-constraint-name.function';

/**
 * Builds the name of the check constraint holding the given predicate.
 *
 * Deterministic for the reason {@link uniqueConstraintName} is, and named by what it checks rather
 * than by its position, so that a check declared beside it or taken away leaves its name alone.
 * @param tableName - The table the constraint belongs to.
 * @param predicate - The condition every row has to meet, as the schema holds it.
 * @returns The constraint name.
 */
export function checkConstraintName(tableName: string, predicate: string): string {
    const hash: string = createHash('sha256')
        .update(predicate)
        .digest('hex')
        .slice(0, 8);
    return `chk_${tableName}_${hash}`;
}