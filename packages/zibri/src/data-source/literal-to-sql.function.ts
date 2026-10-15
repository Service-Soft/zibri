import { InternalError } from '../error-handling/internal-error.model';
import { JsonUtilities } from '../utilities/json.utilities';

/**
 * Writes a value into a statement as a literal, for the statements that cannot take a parameter - a
 * schema predicate, or the conversion of a column's type.
 * @param value - The value to write.
 * @returns The value as sql.
 * @throws When the value cannot be written as a literal.
 */
export function literalToSql(value: unknown): string {
    if (value === null) {
        return 'NULL';
    }
    if (typeof value === 'boolean') {
        return value ? 'TRUE' : 'FALSE';
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new InternalError(`${value} cannot be written into a statement.`);
        }
        return String(value);
    }
    if (value instanceof Date) {
        return `'${value.toISOString()}'`;
    }
    if (typeof value !== 'string') {
        throw new InternalError(
            `${JsonUtilities.stringify(value)} cannot be written into a statement: only a string, number, boolean, date or null can.`
        );
    }
    // escaped even though this comes from a declaration or a migration rather than from a request: a
    // value reaching a statement unescaped is the shape of C5, and a declaration is only trusted until
    // somebody builds one out of configuration
    const escaped: string = value.replaceAll('\'', '\'\'');
    return `'${escaped}'`;
}